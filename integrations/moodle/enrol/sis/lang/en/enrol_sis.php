<?php

$string['pluginname'] = 'SIS enrolment';
$string['pluginname_desc'] = 'Student accounts, course enrolments, and cohorts controlled by SIS.';
$string['sisbaseurl'] = 'SIS base URL';
$string['sisbaseurl_desc'] = 'HTTPS origin for the SIS API, without a trailing slash.';
$string['provisioningsecret'] = 'Provisioning shared secret';
$string['provisioningsecret_desc'] = 'Dedicated secret shared only with the SIS provisioning middleware.';
$string['dryrun'] = 'Dry run';
$string['dryrun_desc'] = 'Poll and validate commands without changing users, enrolments, or cohorts.';
$string['pollbatchsize'] = 'Poll batch size';
$string['pollbatchsize_desc'] = 'Maximum ordered SIS commands to process per scheduled run.';
$string['rosterimport'] = 'Import SIS roster workbook';
$string['rosterimportlink'] = 'Open the SIS roster workbook importer';
$string['rosterimporttitle'] = 'Import current students from SIS';
$string['rosterimporthelp'] = 'Upload the .xlsx workbook exported by SIS. Preview validates every row; select Apply roster only after checking the file. Import creates or updates Moodle accounts with generated passwords that Moodle emails through its scheduled task, applies SIS level course/cohort membership, adds Eagles Club, and records numeric Moodle user IDs back in SIS.';
$string['applyroster'] = 'Apply roster';
$string['rosterimportresult'] = 'Roster import result';
$string['rosterimportpreview'] = 'Workbook validated. Re-upload the same workbook and select Apply roster to import it.';
$string['rosterimportnotconfigured'] = 'Roster import is unavailable until the HTTPS SIS URL and provisioning secret are configured and dry run is disabled.';
$string['sisdisabled'] = 'Enable the SIS enrolment plugin before importing the roster.';
$string['rosterimportinvalid'] = 'The workbook is invalid or does not match the SIS Moodle export format.';
$string['rostermissingcourses'] = 'Create a Moodle course or set its course ID number to match each SIS level before importing: {$a}. No roster accounts were changed.';
$string['sislinkfailed'] = 'Moodle users and SIS memberships were imported, but SIS linking is pending. The scheduled task will retry the signed link.';
$string['sislinkrejected'] = 'SIS rejected the Moodle roster link.';
