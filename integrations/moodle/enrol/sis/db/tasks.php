<?php

defined('MOODLE_INTERNAL') || die();

$tasks = [
    [
        'classname' => '\\enrol_sis\\task\\sync',
        'blocking' => 0,
        'minute' => '*/1',
        'hour' => '*',
        'day' => '*',
        'dayofweek' => '*',
        'month' => '*',
    ],
];
