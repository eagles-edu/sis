<?php

namespace enrol_sis\task;

defined('MOODLE_INTERNAL') || die();

/** Poll SIS commands and return signed, idempotent receipts. */
class sync extends \core\task\scheduled_task {
    public function get_name(): string {
        return get_string('pluginname', 'enrol_sis');
    }

    public function execute(): void {
        $baseurl = rtrim((string)get_config('enrol_sis', 'sisbaseurl'), '/');
        $secret = (string)get_config('enrol_sis', 'provisioningsecret');
        if ($baseurl === '' || $secret === '') {
            mtrace('SIS provisioning is not configured; poll skipped.');
            return;
        }
        if (strpos($baseurl, 'https://') !== 0) {
            mtrace('SIS provisioning requires an HTTPS base URL; poll skipped.');
            return;
        }
        if ((bool)get_config('enrol_sis', 'dryrun')) {
            mtrace('SIS provisioning dry run is enabled; commands were not polled or applied.');
            return;
        }

        $lockfactory = \core\lock\lock_config::get_lock_factory('enrol_sis');
        $lock = $lockfactory->get_lock('command-poll', 0);
        if (!$lock) {
            mtrace('Another SIS provisioning task holds the poll lock.');
            return;
        }
        try {
            $this->retry_pending_links($baseurl, $secret);
            $processor = new \enrol_sis\local\command_processor();
            $poll = $this->request($baseurl . '/api/moodle/provisioning/poll', ['limit' => $this->get_batch_size()], $secret);
            $commands = $poll['commands'] ?? null;
            if (!is_array($commands)) {
                throw new \moodle_exception('invalidresponse', 'enrol_sis');
            }
            foreach ($commands as $command) {
                if (!is_array($command) || empty($command['id']) || empty($command['action']) || empty($command['idempotencyKey'])) {
                    mtrace('Malformed SIS command skipped.');
                    continue;
                }
                $receipt = $processor->apply($command, false, $secret);
                $this->request($baseurl . '/api/moodle/provisioning/receipt', $receipt, $secret);
                if (in_array(($receipt['outcome'] ?? ''), ['retry', 'rejected'], true)) {
                    break;
                }
            }
        } finally {
            $lock->release();
        }
    }

    private function retry_pending_links(string $baseurl, string $secret): void {
        global $DB;
        $pending = $DB->get_records('enrol_sis_link', ['status' => 'pending'], 'timemodified ASC', 'id,userid,eaglesid,studentnumber', 0, 250);
        if (!$pending) {
            return;
        }
        $links = [];
        foreach ($pending as $record) {
            $user = $DB->get_record('user', ['id' => $record->userid, 'deleted' => 0]);
            if (!$user || (string)$user->username !== (string)$record->eaglesid || (string)$user->idnumber !== (string)$record->studentnumber) {
                $DB->update_record('enrol_sis_link', (object)[
                    'id' => $record->id,
                    'status' => 'blocked',
                    'lasterrorcode' => 'local_identity_mismatch',
                    'timemodified' => time(),
                ]);
                continue;
            }
            $links[] = [
                'recordid' => (int)$record->id,
                'eaglesId' => (string)$record->eaglesid,
                'studentNumber' => (int)$record->studentnumber,
                'moodleUserId' => (int)$record->userid,
            ];
        }
        foreach (array_chunk($links, 250) as $batch) {
            $payload = array_map(static function(array $link): array {
                unset($link['recordid']);
                return $link;
            }, $batch);
            try {
                (new \enrol_sis\local\sis_client())->link_users($baseurl, $secret, $payload);
                foreach ($batch as $link) {
                    $DB->update_record('enrol_sis_link', (object)[
                        'id' => $link['recordid'],
                        'status' => 'active',
                        'lasterrorcode' => null,
                        'timemodified' => time(),
                    ]);
                }
            } catch (\Throwable $error) {
                mtrace('SIS roster link retry deferred (' . get_class($error) . ').');
            }
        }
    }

    private function get_batch_size(): int {
        $size = (int)get_config('enrol_sis', 'pollbatchsize');
        return max(1, min(100, $size ?: 25));
    }

    private function request(string $url, array $payload, string $secret): array {
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $timestamp = (string)time();
        $nonce = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        $signature = hash_hmac('sha256', $timestamp . "\n" . $nonce . "\n" . $body, $secret);
        $responseheaders = [];
        $curl = curl_init($url);
        if ($curl === false) {
            throw new \moodle_exception('curlerror', 'enrol_sis');
        }
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-SIS-Source: moodle',
                'X-SIS-Timestamp: ' . $timestamp,
                'X-SIS-Nonce: ' . $nonce,
                'X-SIS-Signature: ' . $signature,
            ],
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$responseheaders): int {
                $length = strlen($line);
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseheaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return $length;
            },
        ]);
        $raw = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if (!is_string($raw) || $status < 200 || $status >= 300) {
            throw new \moodle_exception('sisrequestfailed', 'enrol_sis', '', null, 'HTTP ' . $status . ' ' . $error);
        }
        $responsetimestamp = $responseheaders['x-sis-timestamp'] ?? '';
        $responsenonce = $responseheaders['x-sis-nonce'] ?? '';
        $responsesignature = $responseheaders['x-sis-signature'] ?? '';
        if (!ctype_digit($responsetimestamp) || abs(time() - (int)$responsetimestamp) > 300 || $responsenonce === '') {
            throw new \moodle_exception('invalidsignature', 'enrol_sis');
        }
        $expected = hash_hmac('sha256', $responsetimestamp . "\n" . $responsenonce . "\n" . $raw, $secret);
        if (!hash_equals($expected, $responsesignature)) {
            throw new \moodle_exception('invalidsignature', 'enrol_sis');
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new \moodle_exception('invalidresponse', 'enrol_sis');
        }
        return $decoded;
    }
}
