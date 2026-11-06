<?php

namespace enrol_sis\local;

defined('MOODLE_INTERNAL') || die();

/** Applies SIS-owned account and membership changes without taking over other Moodle data. */
class command_processor {
    /** Apply a command once and return a receipt payload safe for SIS history. */
    public function apply(array $command, bool $dryrun, string $secret): array {
        global $DB;
        $commandid = clean_param((string)($command['id'] ?? ''), PARAM_ALPHANUMEXT);
        $action = clean_param((string)($command['action'] ?? ''), PARAM_ALPHANUMEXT);
        if ($commandid === '' || $action === '') {
            return $this->receipt($commandid, 'rejected', [], 'invalid_command');
        }
        $saved = $DB->get_record('enrol_sis_command', ['commandid' => $commandid]);
        if ($saved) {
            $result = $saved->resultjson ? json_decode($saved->resultjson, true) : [];
            return $this->receipt($commandid, $saved->outcome, is_array($result) ? $result : [], '');
        }

        try {
            $payload = $command['payload'] ?? [];
            if (!is_array($payload)) {
                return $this->receipt($commandid, 'rejected', [], 'invalid_payload');
            }
            $result = match ($action) {
                'upsert_user' => $this->upsert_user($payload),
                'set_password' => $this->set_password($payload, (string)($command['encryptedPayload'] ?? ''), $secret),
                'enrol' => $this->enrol_student($payload),
                'unenrol' => $this->unenrol_student($payload),
                'add_cohort' => $this->add_cohort_member($payload),
                'remove_cohort' => $this->remove_cohort_member($payload),
                'promote_student' => $this->promote_student($payload),
                'disable_user' => $this->disable_user($payload),
                default => throw new \coding_exception('Unsupported SIS command action'),
            };
            if ($dryrun) {
                return $this->receipt($commandid, 'retry', [], 'dry_run');
            }
            $outcome = $action === 'disable_user' ? 'disabled' : 'applied';
            $DB->insert_record('enrol_sis_command', (object)[
                'commandid' => $commandid,
                'outcome' => $outcome,
                'resultjson' => json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'timecreated' => time(),
            ]);
            return $this->receipt($commandid, $outcome, $result, '');
        } catch (\coding_exception $error) {
            return $this->save_rejection($commandid, $error->getMessage());
        } catch (\invalid_parameter_exception $error) {
            return $this->save_rejection($commandid, 'invalid_payload');
        } catch (\Throwable $error) {
            mtrace('SIS provisioning command failed transiently: ' . $commandid . ' (' . get_class($error) . ')');
            return $this->receipt($commandid, 'retry', [], 'transient_error');
        }
    }

    private function receipt(string $commandid, string $outcome, array $result, string $errorcode): array {
        $receipt = ['commandId' => $commandid, 'outcome' => $outcome, 'result' => $result];
        if ($errorcode !== '') {
            $receipt['errorCode'] = substr(clean_param($errorcode, PARAM_ALPHANUMEXT), 0, 80);
            $receipt['retryAfterSeconds'] = 60;
        }
        return $receipt;
    }

    private function save_rejection(string $commandid, string $errorcode): array {
        global $DB;
        $safe = substr(clean_param($errorcode, PARAM_ALPHANUMEXT), 0, 80) ?: 'command_rejected';
        $DB->insert_record('enrol_sis_command', (object)[
            'commandid' => $commandid,
            'outcome' => 'rejected',
            'resultjson' => json_encode(['errorCode' => $safe]),
            'timecreated' => time(),
        ]);
        return $this->receipt($commandid, 'rejected', [], $safe);
    }

    private function upsert_user(array $payload): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/user/lib.php');
        $eaglesid = trim((string)($payload['eaglesId'] ?? ''));
        $studentnumber = trim((string)($payload['studentNumber'] ?? ''));
        $firstname = trim((string)($payload['englishName'] ?? ''));
        $lastname = trim((string)($payload['fullName'] ?? ''));
        $email = trim((string)($payload['email'] ?? ''));
        $level = trim((string)($payload['level'] ?? ''));
        if ($eaglesid === '' || strtolower($eaglesid) !== $eaglesid || $studentnumber === '' || !ctype_digit($studentnumber) || $firstname === '' || $lastname === '' || !validate_email($email) || $level === '') {
            throw new \coding_exception('missing_student_fields');
        }
        $user = $DB->get_record('user', ['username' => $eaglesid, 'deleted' => 0]);
        $numberusers = $DB->get_records('user', ['idnumber' => $studentnumber, 'deleted' => 0]);
        foreach ($numberusers as $numberuser) {
            if (!$user || (int)$numberuser->id !== (int)$user->id) {
                throw new \coding_exception('student_number_conflict');
            }
        }
        if ($user && (string)$user->idnumber !== $studentnumber) {
            throw new \coding_exception('eagles_id_conflict');
        }
        if (!$user) {
            $user = (object)[
                'auth' => 'manual',
                'confirmed' => 1,
                'mnethostid' => $CFG->mnet_localhost_id,
                'username' => $eaglesid,
                'idnumber' => $studentnumber,
                'firstname' => $firstname,
                'lastname' => $lastname,
                'email' => $email,
                'password' => generate_password(),
            ];
            $userid = user_create_user($user, true, true);
        } else {
            $user->firstname = $firstname;
            $user->lastname = $lastname;
            $user->email = $email;
            $user->suspended = 0;
            user_update_user($user, false, true);
            $userid = (int)$user->id;
        }
        return ['moodleUserId' => (int)$userid];
    }

    private function user_by_identity(array $payload): ?\stdClass {
        global $DB;
        $eaglesid = trim((string)($payload['eaglesId'] ?? ''));
        $studentnumber = trim((string)($payload['studentNumber'] ?? ''));
        if ($eaglesid === '' || $studentnumber === '') {
            throw new \coding_exception('invalid_identity');
        }
        $user = $DB->get_record('user', ['username' => $eaglesid, 'deleted' => 0]);
        if ($user && (string)$user->idnumber !== $studentnumber) {
            throw new \coding_exception('identity_conflict');
        }
        $matches = $DB->get_records('user', ['idnumber' => $studentnumber, 'deleted' => 0]);
        foreach ($matches as $match) {
            if (!$user || (int)$match->id !== (int)$user->id) {
                throw new \coding_exception('identity_conflict');
            }
        }
        return $user ?: null;
    }

    private function set_password(array $payload, string $encrypted, string $secret): array {
        global $CFG;
        require_once($CFG->dirroot . '/user/lib.php');
        require_once($CFG->dirroot . '/lib/moodlelib.php');
        $user = $this->user_by_identity($payload);
        if (!$user) {
            throw new \coding_exception('student_not_found');
        }
        $packed = base64_decode($encrypted, true);
        if ($packed === false || strlen($packed) < 29) {
            throw new \coding_exception('invalid_password_payload');
        }
        $key = hash_hkdf('sha256', $secret, 32, 'eagles-sis-moodle-password-v1', '');
        $password = openssl_decrypt(substr($packed, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($packed, 0, 12), substr($packed, 12, 16));
        if (!is_string($password) || $password === '') {
            throw new \coding_exception('password_decryption_failed');
        }
        update_internal_user_password($user, $password);
        unset($password, $packed, $key);
        return ['moodleUserId' => (int)$user->id];
    }

    private function find_level_course(string $level): \stdClass {
        global $DB;
        $matches = $DB->get_records('course', ['idnumber' => $level]);
        if (count($matches) !== 1) {
            throw new \coding_exception(count($matches) ? 'course_idnumber_conflict' : 'course_not_found');
        }
        $course = reset($matches);
        if ((int)$course->id === SITEID) {
            throw new \coding_exception('invalid_course');
        }
        return $course;
    }

    private function sis_instance(\stdClass $course): \stdClass {
        global $DB;
        $instances = $DB->get_records('enrol', ['courseid' => $course->id, 'enrol' => 'sis']);
        if (count($instances) > 1) {
            throw new \coding_exception('sis_enrol_instance_conflict');
        }
        if ($instances) {
            return reset($instances);
        }
        if (!enrol_is_enabled('sis')) {
            throw new \coding_exception('sis_enrolment_disabled');
        }
        $plugin = enrol_get_plugin('sis');
        if (!$plugin) {
            throw new \coding_exception('sis_enrolment_unavailable');
        }
        $instanceid = $plugin->add_instance($course, ['name' => 'SIS student enrolment']);
        return $DB->get_record('enrol', ['id' => $instanceid], '*', MUST_EXIST);
    }

    private function enrol_student(array $payload): array {
        global $CFG;
        require_once($CFG->dirroot . '/lib/enrollib.php');
        $user = $this->user_by_identity($payload);
        if (!$user) {
            throw new \coding_exception('student_not_found');
        }
        $level = trim((string)($payload['level'] ?? ''));
        if ($level === '') {
            throw new \coding_exception('level_required');
        }
        $course = $this->find_level_course($level);
        $instance = $this->sis_instance($course);
        $roles = get_archetype_roles('student');
        $role = reset($roles);
        if (!$role) {
            throw new \coding_exception('student_role_not_found');
        }
        enrol_get_plugin('sis')->enrol_user($instance, $user->id, $role->id);
        return ['courseId' => (int)$course->id, 'moodleUserId' => (int)$user->id];
    }

    private function unenrol_student(array $payload): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/lib/enrollib.php');
        $user = $this->user_by_identity($payload);
        if (!$user) {
            return [];
        }
        $level = trim((string)($payload['level'] ?? ''));
        if ($level === '') {
            throw new \coding_exception('level_required');
        }
        $course = $this->find_level_course($level);
        $instance = $DB->get_record('enrol', ['courseid' => $course->id, 'enrol' => 'sis']);
        if ($instance) {
            enrol_get_plugin('sis')->unenrol_user($instance, $user->id);
        }
        return ['courseId' => (int)$course->id, 'moodleUserId' => (int)$user->id];
    }

    private function promote_student(array $payload): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/lib/enrollib.php');
        require_once($CFG->dirroot . '/cohort/lib.php');
        $user = $this->user_by_identity($payload);
        if (!$user) {
            throw new \coding_exception('student_not_found');
        }
        $fromlevel = trim((string)($payload['fromLevel'] ?? ''));
        $tolevel = trim((string)($payload['toLevel'] ?? ''));
        if ($tolevel === '') {
            throw new \coding_exception('level_required');
        }
        $oldcourse = $fromlevel !== '' && $fromlevel !== $tolevel ? $this->find_level_course($fromlevel) : null;
        $newcourse = $this->find_level_course($tolevel);
        $oldcohort = $fromlevel !== '' && $fromlevel !== $tolevel ? $this->resolve_cohort($fromlevel, $fromlevel, false) : null;
        $newcohort = $this->resolve_cohort($tolevel, $tolevel, false);
        $newinstance = $this->sis_instance($newcourse);
        $roles = get_archetype_roles('student');
        $role = reset($roles);
        if (!$role) {
            throw new \coding_exception('student_role_not_found');
        }
        if (!$newcohort) {
            $newcohort = $this->resolve_cohort($tolevel, $tolevel, true);
        }
        if ($oldcourse) {
            $oldinstance = $DB->get_record('enrol', ['courseid' => $oldcourse->id, 'enrol' => 'sis']);
            if ($oldinstance) {
                enrol_get_plugin('sis')->unenrol_user($oldinstance, $user->id);
            }
        }
        if ($oldcohort) {
            $this->remove_cohort_member(['eaglesId' => $payload['eaglesId'], 'studentNumber' => $payload['studentNumber'], 'cohortIdnumber' => $fromlevel, 'cohortName' => $fromlevel]);
        }
        enrol_get_plugin('sis')->enrol_user($newinstance, $user->id, $role->id);
        $memberexists = $DB->record_exists('cohort_members', ['cohortid' => $newcohort->id, 'userid' => $user->id]);
        if (!$memberexists) {
            cohort_add_member($newcohort->id, $user->id);
            $DB->insert_record('enrol_sis_cohort', (object)['userid' => $user->id, 'cohortid' => $newcohort->id, 'timecreated' => time()]);
        }
        return ['fromLevel' => $fromlevel, 'toLevel' => $tolevel, 'courseId' => (int)$newcourse->id, 'moodleUserId' => (int)$user->id];
    }

    private function resolve_cohort(string $idnumber, string $name, bool $create): ?\stdClass {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/cohort/lib.php');
        $contextid = \context_system::instance()->id;
        $matches = $DB->get_records('cohort', ['contextid' => $contextid, 'idnumber' => $idnumber]);
        if (count($matches) > 1) {
            throw new \coding_exception('cohort_idnumber_conflict');
        }
        if ($matches) {
            $cohort = reset($matches);
            if ((string)$cohort->name !== $name) {
                throw new \coding_exception('cohort_name_conflict');
            }
            return $cohort;
        }
        if ($DB->record_exists('cohort', ['contextid' => $contextid, 'name' => $name])) {
            throw new \coding_exception('cohort_display_name_conflict');
        }
        if (!$create) {
            return null;
        }
        $id = cohort_add_cohort((object)[
            'contextid' => $contextid,
            'name' => $name,
            'idnumber' => $idnumber,
            'description' => 'Managed by SIS enrolment. Do not repurpose.',
            'visible' => 1,
            'component' => 'enrol_sis',
        ]);
        return $DB->get_record('cohort', ['id' => $id], '*', MUST_EXIST);
    }

    private function add_cohort_member(array $payload): array {
        global $DB;
        $user = $this->user_by_identity($payload);
        if (!$user) {
            throw new \coding_exception('student_not_found');
        }
        $idnumber = trim((string)($payload['cohortIdnumber'] ?? ''));
        $name = trim((string)($payload['cohortName'] ?? ''));
        if ($idnumber === '' || $name === '') {
            throw new \coding_exception('cohort_identity_required');
        }
        $cohort = $this->resolve_cohort($idnumber, $name, true);
        $exists = $DB->record_exists('cohort_members', ['cohortid' => $cohort->id, 'userid' => $user->id]);
        if (!$exists) {
            cohort_add_member($cohort->id, $user->id);
            $DB->insert_record('enrol_sis_cohort', (object)['userid' => $user->id, 'cohortid' => $cohort->id, 'timecreated' => time()]);
        }
        return ['cohortId' => (int)$cohort->id, 'moodleUserId' => (int)$user->id];
    }

    private function remove_cohort_member(array $payload): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/cohort/lib.php');
        $user = $this->user_by_identity($payload);
        if (!$user) {
            return [];
        }
        $idnumber = trim((string)($payload['cohortIdnumber'] ?? ''));
        $name = trim((string)($payload['cohortName'] ?? ''));
        if ($idnumber === '' || $name === '') {
            throw new \coding_exception('cohort_identity_required');
        }
        $cohort = $this->resolve_cohort($idnumber, $name, false);
        if (!$cohort) {
            return ['moodleUserId' => (int)$user->id];
        }
        $owned = $DB->get_record('enrol_sis_cohort', ['userid' => $user->id, 'cohortid' => $cohort->id]);
        if ($owned) {
            cohort_remove_member($cohort->id, $user->id);
            $DB->delete_records('enrol_sis_cohort', ['id' => $owned->id]);
        }
        return ['cohortId' => (int)$cohort->id, 'moodleUserId' => (int)$user->id];
    }

    private function disable_user(array $payload): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/user/lib.php');
        require_once($CFG->dirroot . '/lib/enrollib.php');
        require_once($CFG->dirroot . '/cohort/lib.php');
        $user = $this->user_by_identity($payload);
        if (!$user) {
            return ['disabled' => true, 'notFound' => true];
        }
        foreach ($DB->get_records('enrol', ['enrol' => 'sis']) as $instance) {
            if ($DB->record_exists('user_enrolments', ['enrolid' => $instance->id, 'userid' => $user->id])) {
                enrol_get_plugin('sis')->unenrol_user($instance, $user->id);
            }
        }
        foreach ($DB->get_records('enrol_sis_cohort', ['userid' => $user->id]) as $owned) {
            if ($DB->record_exists('cohort_members', ['cohortid' => $owned->cohortid, 'userid' => $user->id])) {
                cohort_remove_member($owned->cohortid, $user->id);
            }
            $DB->delete_records('enrol_sis_cohort', ['id' => $owned->id]);
        }
        $user->suspended = 1;
        user_update_user($user, false, true);
        return ['disabled' => true, 'moodleUserId' => (int)$user->id];
    }
}
