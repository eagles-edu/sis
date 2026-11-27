# Moodle staged release workflow

## Ownership and direction

Moodle code belongs to the separate eagles-edu/staged repository on its main
branch. SIS remains a separate repository and deployment. Production Moodle
and staging Moodle have separate application roots, config.php files, Moodle
data directories, databases, and database users.

The release direction is staged code -> production code. Production is not the
source of code refreshes. The optional refresh-data operation copies only
production database and file data into the isolated staging site so a current
production data snapshot can be used for rehearsal. It deliberately preserves
staging code and staging config.php. Never copy staging database or moodledata
back to production: production owns live learner activity.

Staging is https://staged.eagles.edu.vn; production is
https://moodle.eagles.edu.vn. Both currently use PHP 8.3. Staging keeps mail
disabled, its SIS endpoint and secret unset, enrol_sis Dry run enabled, its
SIS sync task disabled, and its HTTP Basic Authentication barrier. A staging
refresh must retain these guards.

## Release loop

1. On the Moodle development checkout, make changes on a short-lived branch.
   Run Moodle core/plugin checks and idempotency tests, review the diff, then
   merge the reviewed commit to eagles-edu/staged:main. Keep SIS changes in
   the SIS repository.
2. Deploy the current pushed Moodle commit to staging by its full SHA:

    sudo tools/moodle-staging-workflow.sh deploy-stage FULL_MAIN_SHA --dry-run
    sudo tools/moodle-staging-workflow.sh deploy-stage FULL_MAIN_SHA --apply
    sudo tools/moodle-staging-workflow.sh status

   The helper rejects a SHA unless it is the current staged.git/main head,
   downloads and validates that immutable source archive, checks Moodle's
   version does not move backwards, and reports changed source files plus disk
   capacity. Apply first snapshots staging application, moodledata, and database
   under /home/eagles/dockerz/backups/moodle-staging/; it preserves staging
   config.php and staging-only files, runs the Moodle upgrade, re-enforces
   no-mail, unset SIS endpoint/secret, Dry run, and disabled SIS task, then
   records the commit and archive checksum in the private
   /home/staged.eagles.edu.vn/.moodle-release marker. status displays the
   recorded SHA. The roots do not carry Git metadata, so do not infer the
   deployed commit from a local branch name. A deployment is not authenticated
   workflow proof; continue to step 3.

   If dry-run reports zero changed repository files, apply rechecks the staging
   SIS safety settings and records the commit/checksum marker without copying
   files, snapshotting the database/data, or running the Moodle upgrade. The
   dry-run has already compared the exact release source to the installed tree.
3. Test the staged site through its authenticated browser flow. Cover the
   changed plugin/core behavior, repeated operations, upgrade path, scheduled
   task behavior, and the staging safety settings. Do not use production
   learner data as test input for writes or external sends.
4. Review the production target and capacity without changing it:

```bash
sudo tools/moodle-staging-workflow.sh status
sudo tools/moodle-staging-workflow.sh promote --dry-run
```

   Confirm staging carries the reviewed release, its Moodle version is not
   older than production, both environments remain isolated, and the dry-run
   reports adequate space for a private production application/database
   rollback snapshot.
5. When production promotion is explicitly authorized, apply the staged code:

```bash
sudo tools/moodle-staging-workflow.sh promote --apply
```

   The helper snapshots the current production application and database under
   /home/eagles/dockerz/backups/moodle-staging/, verifies both archives,
   enables Moodle maintenance mode, copies staged application code while
   preserving production config.php, runs Moodle's non-interactive upgrade,
   purges caches, disables maintenance mode, and checks the public production
   response. It does not copy staging config.php, database, or moodledata
   into production. If a command fails after maintenance is enabled, the
   helper leaves production in maintenance mode for deliberate recovery.
6. Verify the production login and affected workflows, then record the
   promoted commit SHA, backup path, Moodle upgrade output, HTTP result, and
   authenticated smoke evidence. A successful HTTP response alone is not
   proof that the changed workflow works.

promote --apply changes production code and database schema and must only be
run for an explicitly authorized release. This document and the dry-run do
not authorize production execution.

## Test-mirror SIS provisioning route and verification

The Moodle staging plugin must reach the SIS test mirror through the test-only
Nginx vhost. The tracked location fragment targets the API on `127.0.0.1:8786`;
the installer changes only the test-mirror vhost and verifies that a request
reaches the SIS JSON handler instead of a static-page fallback:

```bash
sudo tools/install-test-moodle-provisioning-proxy.sh --dry-run
sudo tools/install-test-moodle-provisioning-proxy.sh --apply
```

The probe sends an invalid HMAC and expects the test API's JSON 401 response,
or JSON 503 when the test provisioning key is unset. HTTP 200 HTML is a route
failure. Production Nginx and production SIS are outside this installer.

## Active SIS user provisioning (test only)

As of 2026-11-27, staging's `enrol_sis` base URL is
`https://test.eagles.edu.vn`; its shared secret matches the test-owned
`MOODLE_SIS_PROVISIONING_SECRET` in `.env.test`; Dry run is off; and the
`\enrol_sis\task\sync` task is enabled. Moodle staging keeps `noemailever=1`.
The enabled systemd timer `moodle-staging-cron.timer` runs only that scheduled
task every minute as `stage8567` with Moodle's PHP 8.3 CLI. It does not invoke
general Moodle cron or enable tasks unrelated to SIS provisioning.

The test SIS service and worker read only `/home/test.eagles.edu.vn/sis/.env.test`;
the development workspace `.env.test` carries the same test-owned key for
environment-pinned tooling. Do not copy the secret into Git, documentation,
shell history, command output, or another environment. Moodle course
`idnumber` values must uniquely match SIS canonical levels. The current staging
course for `A1 Movers` uses `idnumber=A1 Movers`.

The 2026-11-27 synthetic verification completed account creation, encrypted
password application, Eagles Club cohort membership, and level course
enrollment. Duplicate command receipt replay was idempotent, an invalid HMAC
was rejected with HTTP 401, and SIS due/processing/rejected queue counts were
all zero. A prior synthetic batch was encrypted with an unavailable test key;
its exact database state was backed up and its redacted command audit preserved
before removing only that synthetic batch. No production Moodle, admin/live
SIS, or external email was used.

To pause staging user provisioning, disable `moodle-staging-cron.timer`, enable
Moodle Dry run, and disable the SIS scheduled task. Keep the test SIS target and
secret test-owned; never redirect staging to live/admin SIS. Do not use
production learner data for test writes, provisioning polls, or external sends.

## Recovery and isolated rehearsals

Before a destructive staging recovery, back up both `sis-test` and the isolated
Moodle staging database. For a bounded rehearsal, use only synthetic test-owned
commands, verify the selected batch contains no unrelated learner commands,
and preserve the active timer/task settings after the run. For rollback, first
pause the systemd timer, then restore the exact test and staging backups using
the guarded restore procedures below. Do not restore a test snapshot over
production or copy production learner data into SIS test.

## Optional staging data refresh

Use this only when staging needs a current copy of production data for a
non-production rehearsal. It does not update staging code and is not the
release or promotion path.

```bash
sudo tools/moodle-staging-workflow.sh refresh-data --dry-run
sudo tools/moodle-staging-workflow.sh refresh-data --apply
sudo tools/moodle-staging-workflow.sh status
```

Before applying, the helper snapshots the current staging application,
moodledata, and database. It then copies production moodledata and imports
the production database into staging, runs the staging code's Moodle upgrade,
removes copied SIS endpoint/secret settings, enforces Dry run and the disabled
SIS task, purges staging caches, and restores staging ownership. Staging code
and config.php remain staging-owned. The production application, database,
settings, and services are read-only inputs.

The imported data is sensitive. Keep snapshots outside Git with mode 0700
directories and mode 0600 files. Limit access and retention to authorized
operators. Do not use refresh output or snapshots in tickets, public logs, or
repository fixtures.

## Snapshot restore

The restore command accepts only a complete snapshot under the configured
backup root, and it restores only staging. A restore first snapshots the
current staging state:

```bash
sudo find /home/eagles/dockerz/backups/moodle-staging -mindepth 1 -maxdepth 1 -type d -printf '%f\n'
sudo cat /home/eagles/dockerz/backups/moodle-staging/stage-YYYYMMDDTHHMMSSZ/manifest.txt
sudo tools/moodle-staging-workflow.sh restore /home/eagles/dockerz/backups/moodle-staging/stage-YYYYMMDDTHHMMSSZ --dry-run
sudo tools/moodle-staging-workflow.sh restore /home/eagles/dockerz/backups/moodle-staging/stage-YYYYMMDDTHHMMSSZ --apply
```

Production promotion snapshots include application.tar.gz (including the
production config.php) and database.sql.gz. Treat both as secrets. If
promotion fails after maintenance mode is enabled, leave the site in
maintenance mode and inspect the named snapshot. The guarded rollback restores
the production application and database together, after taking another
production snapshot:

```bash
sudo tools/moodle-staging-workflow.sh rollback-production /home/eagles/dockerz/backups/moodle-staging/production-before-promote-YYYYMMDDTHHMMSSZ --dry-run
sudo tools/moodle-staging-workflow.sh rollback-production /home/eagles/dockerz/backups/moodle-staging/production-before-promote-YYYYMMDDTHHMMSSZ --apply
```

Rollback requires a snapshot manifest naming the production target and accepts
only promotion snapshots in the configured backup root. Do not restore
staging data into production.

## Current evidence and open gates

On 2026-11-24, deploy-stage dry-run and apply targeted staged.git/main at
c9b99195480ab9dc95379c84d71215a977f88aee. The complete repository source tree
comparison found zero changed source files. The helper recorded the commit and
archive SHA-256 in /home/staged.eagles.edu.vn/.moodle-release with mode 0600;
no application file, staging database, or moodledata changed, so no additional
snapshot or Moodle upgrade was needed. Existing staging-only files remain
preserved. Status still confirms mail disabled, SIS target/secret unset, Dry run
on, and the scheduled task disabled. KA-241/242 completed the authenticated
staging login, signed test-SIS poll, receipt, idempotency replay, and exact-SHA
release gates against this recorded commit. The test provisioning queue was
cleaned and the staging safety settings restored afterward. Production was not
changed or promoted.


On 2026-11-23, both Moodle vhosts were moved to PHP 8.3 FPM. The staging
database and data refresh completed from production, and its pre-refresh
snapshot is /home/eagles/dockerz/backups/moodle-staging/stage-20261123T100657Z.
The archive passed gzip -t; staging status showed distinct mood_test51 and
moodle_stage8567 databases, no staging SIS URL or secret, Dry run 1, and the
SIS scheduled task disabled. This refresh did not promote staged code to
production. The signed test-SIS provisioning poll and authenticated external
staging walkthrough were later completed under KA-241/242. Production promotion
has not been run by this workflow.

## References

- Moodle upgrade procedure: https://docs.moodle.org/503/en/Upgrading
- Moodle Git administration: https://docs.moodle.org/503/en/Git_for_Administrators
- Moodle command-line administration: https://docs.moodle.org/503/en/Administration_via_command_line
- Moodle plugin CI: https://github.com/moodlehq/moodle-plugin-ci
- Moodle community discussion of staging and production data: https://moodle.org/mod/forum/discuss.php?d=385118
