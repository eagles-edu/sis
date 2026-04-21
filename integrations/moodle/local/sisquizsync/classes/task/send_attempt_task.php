<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

namespace local_sisquizsync\task;

defined('MOODLE_INTERNAL') || die();

use local_sisquizsync\payload_builder;
use local_sisquizsync\service;
use mod_quiz\quiz_attempt;

class send_attempt_task extends \core\task\adhoc_task {
    public function get_name() {
        return get_string('tasksendattempt', 'local_sisquizsync');
    }

    public function execute(): void {
        global $DB;

        $customdata = $this->get_custom_data();
        $attemptid = (int) ($customdata->attemptid ?? 0);
        if ($attemptid <= 0) {
            throw new \coding_exception('Missing quiz attempt id for local_sisquizsync task');
        }

        $attempt = quiz_attempt::create($attemptid);
        $user = $DB->get_record('user', ['id' => $attempt->get_userid()], 'id, username, email', MUST_EXIST);
        $payload = payload_builder::build_from_attempt($attempt, $user);
        service::send_payload($payload);
    }
}
