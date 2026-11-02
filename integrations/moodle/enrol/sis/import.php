<?php

define('NO_OUTPUT_BUFFERING', true);
require_once(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');

admin_externalpage_setup('enrol_sis_import_users');
$context = context_system::instance();
require_capability('moodle/site:uploadusers', $context);

$url = new moodle_url('/enrol/sis/import.php');
$title = get_string('rosterimporttitle', 'enrol_sis');
$PAGE->set_context($context);
$PAGE->set_url($url);
$PAGE->set_title($title);
$PAGE->set_heading($title);
$form = new \enrol_sis\form\import($url);
$importer = new \enrol_sis\local\roster_importer();

echo $OUTPUT->header();
echo $OUTPUT->heading($title);

if ($data = $form->get_data()) {
    try {
        $content = $form->get_file_content('rosterfile');
        $rows = $importer->parse_workbook($content);
        $importer->preflight($rows);
        if (!empty($data->applyroster)) {
            $result = $importer->import_workbook($rows, $content);
            echo $OUTPUT->notification(get_string('rosterimportresult', 'enrol_sis') . ': ' . $result['count'], 'notifysuccess');
            if (!empty($result['stats'])) {
                echo html_writer::tag('p', s(implode(' | ', $result['stats'])));
            }
            if (!empty($result['progresshtml'])) {
                echo $result['progresshtml'];
            }
            if (!empty($result['pending'])) {
                echo $OUTPUT->notification(get_string('sislinkfailed', 'enrol_sis'), 'notifyproblem');
            }
            echo html_writer::tag('p', get_string('continue'), ['class' => 'mt-3']);
        } else {
            $preview = [];
            foreach (array_slice($rows, 0, 10) as $row) {
                $preview[] = [$row['eaglesId'], $row['studentNumber'], $row['fullName'], $row['level']];
            }
            echo $OUTPUT->notification(get_string('rosterimportpreview', 'enrol_sis') . ' Rows: ' . count($rows), 'notifymessage');
            $table = new html_table();
            $table->head = ['Eagles ID', 'Student number', 'Student', 'SIS level'];
            $table->data = $preview;
            echo html_writer::table($table);
        }
    } catch (\Throwable $error) {
        debugging('SIS roster workbook import failed: ' . get_class($error), DEBUG_DEVELOPER);
        $message = get_string('rosterimportinvalid', 'enrol_sis');
        if ($error instanceof \moodle_exception && $error->module === 'enrol_sis' && $error->errorcode === 'rostermissingcourses') {
            $message = get_string('rostermissingcourses', 'enrol_sis', $error->a);
        }
        echo $OUTPUT->notification(s($message), 'notifyproblem');
    }
}

$form->display();
echo $OUTPUT->footer();

