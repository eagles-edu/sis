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
failure. The scheduled Moodle task remains disabled during routine staging
setup. Production Nginx and production SIS are outside this installer.

For an explicitly authorized, one-off integration rehearsal:

1. Back up the SIS test database and isolated Moodle staging database. Confirm
   the exact test SIS database and ensure the selected poll batch contains only
   the rehearsal's synthetic command IDs. Do not poll unrelated pending,
   retry, or processing commands.
2. Keep the scheduled task disabled. Configure staging's `enrol_sis` base URL
   to `https://test.eagles.edu.vn`, set its provisioning secret to the
   test-runtime-owned `.env.test` key, temporarily set Dry run off, and limit
   the batch to the isolated commands. Never copy the secret into Git, docs,
   shell history, or logs.
3. Execute the task once from the staging Moodle root, using Moodle's writable
   staging temp directory if the shell's inherited `TMPDIR` is unavailable:

   ```bash
   sudo -u stage8567 env TMPDIR=/home/staged.eagles.edu.vn/moodledata/temp \
     /usr/local/lsws/lsphp83/bin/php \
     /home/staged.eagles.edu.vn/app/admin/cli/scheduled_task.php \
     --execute='\enrol_sis\task\sync'
   ```

   Verify signed polling and receipts, one Moodle account, the expected course
   enrollment and cohort memberships, and an active SIS/Moodle user link.
   Replay only the same command IDs and confirm the Moodle idempotency records
   prevent duplicate users, enrollments, or memberships.
4. Remove only the rehearsal's synthetic SIS and Moodle records. Restore the
   staging SIS URL and secret to unset, Dry run on, the original batch size,
   mail disabled, and the scheduled task disabled; purge staging caches. Restore
   the test `.env.test` backup and restart the test SIS service if its
   provisioning key was enabled for the rehearsal. Verify staging and test
   health, the JSON unconfigured response, and the retained Basic Auth login.

These steps do not authorize production changes. Do not use production learner
data for writes, provisioning polls, or external sends.

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
