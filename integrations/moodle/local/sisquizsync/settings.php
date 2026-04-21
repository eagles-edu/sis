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

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_sisquizsync', get_string('pluginname', 'local_sisquizsync'));
    $defaultendpointurl = getenv('SIS_QUIZ_SYNC_ENDPOINT_URL') ?: 'https://test.eagles.edu.vn/api/exercise-submission';

    $settings->add(new admin_setting_heading(
        'local_sisquizsync/heading',
        get_string('settingsheading', 'local_sisquizsync'),
        get_string('settingsheading_desc', 'local_sisquizsync')
    ));

    $settings->add(new admin_setting_configcheckbox(
        'local_sisquizsync/enabled',
        get_string('enabled', 'local_sisquizsync'),
        get_string('enabled_desc', 'local_sisquizsync'),
        0
    ));

    $settings->add(new admin_setting_configtext(
        'local_sisquizsync/endpointurl',
        get_string('endpointurl', 'local_sisquizsync'),
        get_string('endpointurl_desc', 'local_sisquizsync'),
        $defaultendpointurl,
        PARAM_URL
    ));

    $settings->add(new admin_setting_configpasswordunmask(
        'local_sisquizsync/sharedsecret',
        get_string('sharedsecret', 'local_sisquizsync'),
        get_string('sharedsecret_desc', 'local_sisquizsync'),
        ''
    ));

    $settings->add(new admin_setting_configtext(
        'local_sisquizsync/timeoutseconds',
        get_string('timeoutseconds', 'local_sisquizsync'),
        get_string('timeoutseconds_desc', 'local_sisquizsync'),
        '10',
        PARAM_INT
    ));

    $settings->add(new admin_setting_configtext(
        'local_sisquizsync/retrycount',
        get_string('retrycount', 'local_sisquizsync'),
        get_string('retrycount_desc', 'local_sisquizsync'),
        '3',
        PARAM_INT
    ));

    $ADMIN->add('localplugins', $settings);
}
