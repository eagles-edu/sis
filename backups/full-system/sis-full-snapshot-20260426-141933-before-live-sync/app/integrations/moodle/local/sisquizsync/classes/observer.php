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

namespace local_sisquizsync;

defined('MOODLE_INTERNAL') || die();

use mod_quiz\event\attempt_submitted;

class observer {
    public static function attempt_submitted(attempt_submitted $event): void {
        $config = get_config('local_sisquizsync');
        if (empty($config->enabled) || empty($config->endpointurl) || empty($config->sharedsecret)) {
            return;
        }

        $task = new \local_sisquizsync\task\send_attempt_task();
        $task->set_custom_data([
            'attemptid' => (int) $event->objectid,
        ]);
        \core\task\manager::queue_adhoc_task($task, true);
    }
}
