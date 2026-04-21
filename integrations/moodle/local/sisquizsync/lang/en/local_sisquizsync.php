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

$string['pluginname'] = 'SIS quiz sync';
$string['settingsheading'] = 'SIS quiz sync';
$string['settingsheading_desc'] = 'Send Moodle quiz submission results to SIS using the existing exercise submission contract.';
$string['enabled'] = 'Enable SIS quiz sync';
$string['enabled_desc'] = 'When enabled, submitted quiz attempts are queued for delivery to SIS.';
$string['endpointurl'] = 'SIS endpoint URL';
$string['endpointurl_desc'] = 'Absolute URL for the SIS /api/exercise-submission endpoint. Use https://test.eagles.edu.vn/api/exercise-submission for the v2 test target; admin.eagles.edu.vn is v1 and separate.';
$string['sharedsecret'] = 'Shared secret';
$string['sharedsecret_desc'] = 'Shared secret used to sign quiz result payloads before sending them to SIS.';
$string['timeoutseconds'] = 'Request timeout (seconds)';
$string['timeoutseconds_desc'] = 'Maximum time allowed for a single outbound SIS request.';
$string['retrycount'] = 'Retry count';
$string['retrycount_desc'] = 'Number of times to retry a failed outbound SIS request before the task fails.';
$string['tasksendattempt'] = 'Send quiz submission to SIS';
$string['sisquizsyncfailed'] = 'Failed to send quiz submission to SIS';
