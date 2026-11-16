<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    $settings->add(new admin_setting_configtext(
        'enrol_sis/sisbaseurl',
        get_string('sisbaseurl', 'enrol_sis'),
        get_string('sisbaseurl_desc', 'enrol_sis'),
        '',
        PARAM_URL
    ));
    $settings->add(new admin_setting_configpasswordunmask(
        'enrol_sis/provisioningsecret',
        get_string('provisioningsecret', 'enrol_sis'),
        get_string('provisioningsecret_desc', 'enrol_sis'),
        ''
    ));
    $settings->add(new admin_setting_configcheckbox(
        'enrol_sis/dryrun',
        get_string('dryrun', 'enrol_sis'),
        get_string('dryrun_desc', 'enrol_sis'),
        1
    ));
    $settings->add(new admin_setting_configtext(
        'enrol_sis/pollbatchsize',
        get_string('pollbatchsize', 'enrol_sis'),
        get_string('pollbatchsize_desc', 'enrol_sis'),
        '25',
        PARAM_INT
    ));
    $settings->add(new admin_setting_description(
        'enrol_sis/rosterimportlink',
        get_string('rosterimport', 'enrol_sis'),
        html_writer::link(new moodle_url('/enrol/sis/import.php'), get_string('rosterimportlink', 'enrol_sis'))
    ));
}

if ($hassiteconfig) {
    $ADMIN->add('enrolments', new admin_externalpage(
        'enrol_sis_import_users',
        get_string('rosterimport', 'enrol_sis'),
        new moodle_url('/enrol/sis/import.php'),
        'moodle/site:uploadusers'
    ));
}
