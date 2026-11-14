<?php

defined('MOODLE_INTERNAL') || die();

function xmldb_enrol_sis_upgrade(int $oldversion): bool {
    global $DB;
    $dbman = $DB->get_manager();

    if ($oldversion < 2026102710) {
        $table = new xmldb_table('enrol_sis_link');
        if (!$dbman->table_exists($table)) {
            $table->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $table->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table->add_field('eaglesid', XMLDB_TYPE_CHAR, '100', null, XMLDB_NOTNULL, null, null);
            $table->add_field('studentnumber', XMLDB_TYPE_CHAR, '100', null, XMLDB_NOTNULL, null, null);
            $table->add_field('status', XMLDB_TYPE_CHAR, '20', null, XMLDB_NOTNULL, null, null);
            $table->add_field('lasterrorcode', XMLDB_TYPE_CHAR, '80', null, null, null, null);
            $table->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $table->add_key('userid_uix', XMLDB_KEY_UNIQUE, ['userid']);
            $table->add_key('eaglesid_uix', XMLDB_KEY_UNIQUE, ['eaglesid']);
            $table->add_key('studentnumber_uix', XMLDB_KEY_UNIQUE, ['studentnumber']);
            $table->add_key('userid_fk', XMLDB_KEY_FOREIGN, ['userid'], 'user', ['id']);
            $table->add_index('status_time_ix', XMLDB_INDEX_NOTUNIQUE, ['status', 'timemodified']);
            $dbman->create_table($table);
        }
        upgrade_plugin_savepoint(true, 2026102710, 'enrol', 'sis');
    }
    return true;
}
