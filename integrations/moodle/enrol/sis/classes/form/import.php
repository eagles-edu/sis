<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

namespace enrol_sis\form;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/formslib.php');

/** Admin-only upload form for the SIS-produced Moodle roster workbook. */
class import extends \moodleform {
    protected function definition(): void {
        $form = $this->_form;
        $context = \context_system::instance();
        $maxbytes = get_user_max_upload_file_size($context, $GLOBALS['CFG']->maxbytes, 0, 0, $GLOBALS['USER']->id);
        $form->addElement('header', 'rosterheader', get_string('rosterimporttitle', 'enrol_sis'));
        $form->addElement('static', 'rosterhelp', '', get_string('rosterimporthelp', 'enrol_sis'));
        $form->addElement('filepicker', 'rosterfile', get_string('file'), null, [
            'accepted_types' => ['.xlsx'],
            'maxbytes' => $maxbytes,
        ]);
        $form->addRule('rosterfile', null, 'required');
        $form->addElement('advcheckbox', 'applyroster', get_string('applyroster', 'enrol_sis'));
        $form->setDefault('applyroster', 0);
        $this->add_action_buttons(false, get_string('upload'));
    }
}

