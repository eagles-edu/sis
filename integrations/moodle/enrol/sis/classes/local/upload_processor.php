<?php

namespace enrol_sis\local;

defined('MOODLE_INTERNAL') || die();

/** Exposes structured completion counters from Moodle's native user uploader. */
class upload_processor extends \tool_uploaduser\process {
    public function get_completion_counts(): array {
        return [
            'created' => (int)$this->usersnew,
            'updated' => (int)$this->usersupdated,
            'unchanged' => (int)$this->usersuptodate,
            'errors' => (int)$this->userserrors,
            'skipped' => (int)$this->usersskipped,
        ];
    }
}
