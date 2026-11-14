<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

defined('MOODLE_INTERNAL') || die();

/** SIS owns only enrolments created through the enrol_sis instance. */
class enrol_sis_plugin extends enrol_plugin {
    /** Prevent staff from manually creating SIS-controlled enrolments in course UI. */
    public function allow_enrol(stdClass $instance) {
        return false;
    }

    /** Prevent manual changes from this enrolment method in course UI. */
    public function allow_manage(stdClass $instance) {
        return false;
    }

    /** Keep SIS enrolments controlled by the SIS outbox. */
    public function allow_unenrol_user(stdClass $instance, stdClass $ue) {
        return false;
    }
}
