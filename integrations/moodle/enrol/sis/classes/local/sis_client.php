<?php

namespace enrol_sis\local;

defined('MOODLE_INTERNAL') || die();

/** Signed SIS client used by roster imports and scheduled link retries. */
class sis_client {
    public function link_users(string $baseurl, string $secret, array $links): array {
        if (count($links) < 1 || count($links) > 500) {
            throw new \coding_exception('Invalid SIS link batch size');
        }
        $url = rtrim($baseurl, '/') . '/api/moodle/provisioning/link';
        $body = json_encode(['links' => array_values($links)], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
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
        if (!is_string($raw)) {
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
        if ($status < 200 || $status >= 300 || (int)($decoded['linked'] ?? -1) !== count($links)) {
            $code = preg_match('/^[a-z0-9_-]{1,80}$/i', (string)($decoded['errorCode'] ?? ''))
                ? (string)$decoded['errorCode']
                : 'link_rejected';
            throw new \moodle_exception('sislinkrejected', 'enrol_sis', '', null, $code);
        }
        return $decoded;
    }
}

