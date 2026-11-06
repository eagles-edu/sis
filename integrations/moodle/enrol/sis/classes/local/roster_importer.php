<?php

namespace enrol_sis\local;

defined('MOODLE_INTERNAL') || die();

/** Validates SIS roster workbooks and applies them through Moodle's user-upload processor. */
class roster_importer {
    private const MAX_FILE_BYTES = 10485760;
    private const MAX_ROWS = 5000;

    public function parse_workbook(string $content): array {
        global $CFG;
        if ($content === '' || strlen($content) > self::MAX_FILE_BYTES || substr($content, 0, 2) !== 'PK') {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        require_once($CFG->dirroot . '/lib/phpspreadsheet/vendor/autoload.php');
        $directory = make_temp_directory('enrol_sis');
        $path = tempnam($directory, 'roster-');
        if ($path === false) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        try {
            chmod($path, 0600);
            if (file_put_contents($path, $content, LOCK_EX) !== strlen($content)) {
                throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
            }
            $reader = \PhpOffice\PhpSpreadsheet\IOFactory::createReader('Xlsx');
            $reader->setReadDataOnly(true);
            $workbook = $reader->load($path);
            $moodledata = $this->read_sheet($workbook->getSheetByName('Moodle CSV'), ['username', 'idnumber', 'firstname', 'lastname', 'email']);
            $sisdata = $this->read_sheet($workbook->getSheetByName('SIS Link'), ['eaglesid', 'studentnumber', 'englishname', 'fullname', 'email', 'level']);
            if (!$moodledata || count($moodledata) !== count($sisdata) || count($sisdata) > self::MAX_ROWS) {
                throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
            }

            $rows = [];
            $seenids = [];
            $seennumbers = [];
            $seenemails = [];
            foreach ($sisdata as $index => $sisrow) {
                $moodlerow = $moodledata[$index];
                $row = [
                    'eaglesId' => trim((string)$sisrow['eaglesid']),
                    'studentNumber' => trim((string)$sisrow['studentnumber']),
                    'englishName' => trim((string)$sisrow['englishname']),
                    'fullName' => trim((string)$sisrow['fullname']),
                    'email' => strtolower(trim((string)$sisrow['email'])),
                    'level' => trim((string)$sisrow['level']),
                ];
                if ($row['eaglesId'] === '' || !preg_match('/^[a-z0-9._@-]{1,100}$/', $row['eaglesId']) ||
                        !ctype_digit($row['studentNumber']) || (int)$row['studentNumber'] < 1 ||
                        $row['englishName'] === '' || $row['fullName'] === '' || $row['level'] === '' ||
                        !validate_email($row['email'])) {
                    throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
                }
                if ($row['eaglesId'] !== trim((string)$moodlerow['username']) ||
                        $row['studentNumber'] !== trim((string)$moodlerow['idnumber']) ||
                        $row['englishName'] !== trim((string)$moodlerow['firstname']) ||
                        $row['fullName'] !== trim((string)$moodlerow['lastname']) ||
                        $row['email'] !== strtolower(trim((string)$moodlerow['email']))) {
                    throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
                }
                if (isset($seenids[$row['eaglesId']]) || isset($seennumbers[$row['studentNumber']]) ||
                        (empty($CFG->allowaccountssameemail) && isset($seenemails[$row['email']]))) {
                    throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
                }
                $seenids[$row['eaglesId']] = true;
                $seennumbers[$row['studentNumber']] = true;
                $seenemails[$row['email']] = true;
                $rows[] = $row;
            }
            return $rows;
        } catch (\moodle_exception $error) {
            throw $error;
        } catch (\Throwable $error) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis', '', null, get_class($error));
        } finally {
            @unlink($path);
        }
    }

    private function read_sheet(?\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet, array $requiredheaders): array {
        if (!$sheet) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        $data = $sheet->toArray(null, true, true, false);
        if (!$data || !is_array($data[0] ?? null)) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        $headers = array_map(static fn($value): string => strtolower(trim((string)$value, " \t\n\r\0\x0B")), array_shift($data));
        if (array_values($headers) !== $requiredheaders) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        $rows = [];
        foreach ($data as $values) {
            $values = array_slice(array_pad($values, count($headers), ''), 0, count($headers));
            if (count(array_filter($values, static fn($value): bool => trim((string)$value) !== '')) === 0) {
                continue;
            }
            $rows[] = array_combine($headers, array_map(static fn($value): string => trim((string)$value), $values));
        }
        return $rows;
    }

    public function preflight(array $rows): void {
        global $CFG, $DB;
        $contextid = \context_system::instance()->id;
        $levels = array_values(array_unique(array_map(static fn(array $row): string => $row['level'], $rows)));
        $missingcourses = [];
        foreach ($levels as $level) {
            $courses = $DB->get_records('course', ['idnumber' => $level], '', 'id,idnumber');
            if (count($courses) !== 1 || (int)reset($courses)->id === SITEID) {
                $missingcourses[] = $level;
            }
        }
        if ($missingcourses) {
            throw new \moodle_exception('rostermissingcourses', 'enrol_sis', '', implode(', ', $missingcourses));
        }
        foreach ($rows as $row) {
            $user = $DB->get_record('user', ['username' => $row['eaglesId'], 'deleted' => 0]);
            if ($user && (string)$user->idnumber !== $row['studentNumber']) {
                throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
            }
            $numbermatches = $DB->get_records('user', ['idnumber' => $row['studentNumber'], 'deleted' => 0], '', 'id,username');
            foreach ($numbermatches as $match) {
                if (!$user || (int)$match->id !== (int)$user->id) {
                    throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
                }
            }
            if (empty($CFG->allowaccountssameemail) && $DB->record_exists_select(
                    'user', 'LOWER(email) = LOWER(?) AND username <> ? AND deleted = 0', [$row['email'], $row['eaglesId']])) {
                throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
            }
            $this->validate_cohort($contextid, $row['level'], $row['level']);
            $this->validate_cohort($contextid, 'eagles-club', 'Eagles Club');
            $link = $DB->get_record('enrol_sis_link', ['eaglesid' => $row['eaglesId']]);
            if ($link && $user && (int)$link->userid !== (int)$user->id) {
                throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
            }
        }
    }

    private function validate_cohort(int $contextid, string $idnumber, string $name): void {
        global $DB;
        $cohorts = $DB->get_records('cohort', ['contextid' => $contextid, 'idnumber' => $idnumber], '', 'id,name');
        if (count($cohorts) > 1 || ($cohorts && (string)reset($cohorts)->name !== $name)) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        if (!$cohorts && $DB->record_exists('cohort', ['contextid' => $contextid, 'name' => $name])) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
    }

    private function build_native_csv(array $rows): string {
        $stream = fopen('php://temp', 'w+b');
        if ($stream === false) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        fputcsv($stream, ['username', 'idnumber', 'firstname', 'lastname', 'email'], ',', '"', '');
        foreach ($rows as $row) {
            fputcsv($stream, [$row['eaglesId'], $row['studentNumber'], $row['englishName'], $row['fullName'], $row['email']], ',', '"', '');
        }
        rewind($stream);
        $csv = stream_get_contents($stream);
        fclose($stream);
        if (!is_string($csv)) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        return $csv;
    }

    private function import_native_users(array $rows): array {
        global $CFG;
        require_once($CFG->dirroot . '/' . $CFG->admin . '/tool/uploaduser/locallib.php');
        $instanceid = \csv_import_reader::get_new_iid('enrol_sis_roster');
        $reader = new \csv_import_reader($instanceid, 'enrol_sis_roster');
        $readcount = $reader->load_csv_content($this->build_native_csv($rows), 'UTF-8', 'comma');
        if ($readcount !== count($rows) + 1 || $reader->get_error() !== null) {
            $reader->cleanup(true);
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        $processor = new upload_processor($reader);
        $processor->get_file_columns();
        $processor->set_form_data((object)[
            'uutype' => UU_USER_ADD_UPDATE,
            'uupasswordnew' => 1,
            'uuupdatetype' => UU_UPDATE_FILEOVERRIDE,
            'uupasswordold' => 0,
            'uuforcepasswordchange' => UU_PWRESET_ALL,
            'uuallowrenames' => 0,
            'uuallowdeletes' => 0,
            'uuallowsuspends' => 0,
            'uunoemailduplicates' => empty($CFG->allowaccountssameemail) ? 1 : 0,
            'uustandardusernames' => 1,
            'uubulk' => UU_BULK_NONE,
        ]);
        ob_start();
        try {
            $processor->process();
            $progresshtml = ob_get_contents();
        } finally {
            ob_end_clean();
            $reader->cleanup(true);
        }
        $counts = $processor->get_completion_counts();
        $processed = $counts['created'] + $counts['updated'] + $counts['unchanged'];
        if ($counts['errors'] > 0 || $counts['skipped'] > 0 || $processed !== count($rows)) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        return ['stats' => $processor->get_stats(), 'progresshtml' => is_string($progresshtml) ? $progresshtml : ''];
    }

    private function apply_sis_memberships(array $rows, string $secret, string $importid): array {
        global $DB;
        $processor = new command_processor();
        $links = [];
        $now = time();
        foreach ($rows as $row) {
            $user = $DB->get_record('user', ['username' => $row['eaglesId'], 'deleted' => 0]);
            if (!$user || (string)$user->idnumber !== $row['studentNumber']) {
                throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
            }
            $base = ['eaglesId' => $row['eaglesId'], 'studentNumber' => $row['studentNumber']];
            $commands = [
                ['action' => 'upsert_user', 'payload' => $base + [
                    'englishName' => $row['englishName'], 'fullName' => $row['fullName'], 'email' => $row['email'], 'level' => $row['level'],
                ]],
                ['action' => 'promote_student', 'payload' => $base + ['fromLevel' => '', 'toLevel' => $row['level']]],
                ['action' => 'add_cohort', 'payload' => $base + ['cohortIdnumber' => 'eagles-club', 'cohortName' => 'Eagles Club']],
            ];
            foreach ($commands as $command) {
                $id = 'roster' . $importid . substr(hash('sha256', $row['eaglesId']), 0, 16) . $command['action'];
                $receipt = $processor->apply(['id' => $id, 'action' => $command['action'], 'payload' => $command['payload']], false, $secret);
                if (($receipt['outcome'] ?? '') !== 'applied') {
                    throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
                }
            }
            $link = $DB->get_record('enrol_sis_link', ['eaglesid' => $row['eaglesId']]);
            if ($link) {
                $link->userid = (int)$user->id;
                $link->studentnumber = $row['studentNumber'];
                $link->status = 'pending';
                $link->lasterrorcode = null;
                $link->timemodified = $now;
                $DB->update_record('enrol_sis_link', $link);
            } else {
                $DB->insert_record('enrol_sis_link', (object)[
                    'userid' => (int)$user->id,
                    'eaglesid' => $row['eaglesId'],
                    'studentnumber' => $row['studentNumber'],
                    'status' => 'pending',
                    'lasterrorcode' => null,
                    'timecreated' => $now,
                    'timemodified' => $now,
                ]);
            }
            $links[] = ['eaglesId' => $row['eaglesId'], 'studentNumber' => (int)$row['studentNumber'], 'moodleUserId' => (int)$user->id];
        }
        return $links;
    }

    public function import_workbook(array $rows, string $content): array {
        global $DB;
        $baseurl = rtrim((string)get_config('enrol_sis', 'sisbaseurl'), '/');
        $secret = (string)get_config('enrol_sis', 'provisioningsecret');
        if ($baseurl === '' || strpos($baseurl, 'https://') !== 0 || $secret === '' || (bool)get_config('enrol_sis', 'dryrun')) {
            throw new \moodle_exception('rosterimportnotconfigured', 'enrol_sis');
        }
        if (!enrol_is_enabled('sis')) {
            throw new \moodle_exception('sisdisabled', 'enrol_sis');
        }
        $this->preflight($rows);
        $lockfactory = \core\lock\lock_config::get_lock_factory('enrol_sis');
        $lock = $lockfactory->get_lock('roster-import', 0);
        if (!$lock) {
            throw new \moodle_exception('rosterimportinvalid', 'enrol_sis');
        }
        try {
            $native = $this->import_native_users($rows);
            $importid = bin2hex(random_bytes(6));
            $links = $this->apply_sis_memberships($rows, $secret, $importid);
            $pending = count($links);
            try {
                $client = new sis_client();
                foreach (array_chunk($links, 250) as $batch) {
                    $client->link_users($baseurl, $secret, $batch);
                    foreach ($batch as $linkdata) {
                        $DB->set_field('enrol_sis_link', 'status', 'active', ['eaglesid' => $linkdata['eaglesId']]);
                        $DB->set_field('enrol_sis_link', 'lasterrorcode', null, ['eaglesid' => $linkdata['eaglesId']]);
                        $DB->set_field('enrol_sis_link', 'timemodified', time(), ['eaglesid' => $linkdata['eaglesId']]);
                    }
                    $pending -= count($batch);
                }
            } catch (\Throwable $error) {
                mtrace('SIS roster link deferred for scheduled retry (' . get_class($error) . ').');
            }
            return [
                'count' => count($rows),
                'linked' => count($links) - $pending,
                'pending' => $pending,
                'stats' => $native['stats'],
                'progresshtml' => $native['progresshtml'],
            ];
        } finally {
            $lock->release();
        }
    }
}

