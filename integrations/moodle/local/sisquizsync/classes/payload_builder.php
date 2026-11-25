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

use mod_quiz\quiz_attempt;

class payload_builder {
    public static function build_from_attempt(quiz_attempt $attempt, \stdClass $user): array {
        $attemptrecord = $attempt->get_attempt();
        $slots = $attempt->get_slots('all');
        $totalquestions = 0;
        $correctcount = 0;
        $pendingcount = 0;
        $incorrectcount = 0;

        foreach ($slots as $slot) {
            if (!$attempt->is_real_question($slot)) {
                continue;
            }

            $totalquestions += 1;
            $questionattempt = $attempt->get_question_attempt($slot);
            $state = $questionattempt->get_state();

            if (!$state->is_graded()) {
                $pendingcount += 1;
                continue;
            }

            $fraction = (float) $questionattempt->get_fraction();
            if ($fraction >= 1.0) {
                $correctcount += 1;
            } else {
                $incorrectcount += 1;
            }
        }

        $scorepercent = $totalquestions > 0 ? round(($correctcount / $totalquestions) * 100, 2) : 0.0;
        $startedat = (int) ($attemptrecord->timestart ?? 0);
        $completedat = (int) ($attemptrecord->timefinish ?: $attemptrecord->timemodified ?: time());

        return [
            'eaglesId' => (string) $user->username,
            'email' => isset($user->email) ? trim((string) $user->email) : '',
            'pageTitle' => (string) $attempt->get_quiz_name(),
            'startedAt' => $startedat > 0 ? gmdate('c', $startedat) : '',
            'completedAt' => gmdate('c', $completedat),
            'totalQuestions' => $totalquestions,
            'correctCount' => $correctcount,
            'pendingCount' => $pendingcount,
            'incorrectCount' => $incorrectcount,
            'scorePercent' => $scorepercent,
            'recipients' => [],
            'sourceSystem' => 'moodle',
            'sourceAttemptId' => (string) $attemptrecord->id,
        ];
    }
}
