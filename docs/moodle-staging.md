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
2. Deploy that exact pushed Moodle commit to the staging Moodle runtime.
   Record its commit SHA and deployment result with the release record. The
   deployed Moodle roots do not carry Git metadata, so do not infer the
   deployed commit from a local branch name.
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

On 2026-11-23, both Moodle vhosts were moved to PHP 8.3 FPM. The staging
database and data refresh completed from production, and its pre-refresh
snapshot is /home/eagles/dockerz/backups/moodle-staging/stage-20261123T100657Z.
The archive passed gzip -t; staging status showed distinct mood_test51 and
moodle_stage8567 databases, no staging SIS URL or secret, Dry run 1, and the
SIS scheduled task disabled. This refresh did not promote staged code to
production. The signed test-SIS provisioning poll and authenticated external
staging walkthrough remain open. Production promotion has not been run by
this workflow.

## References

- Moodle upgrade procedure: https://docs.moodle.org/503/en/Upgrading
- Moodle Git administration: https://docs.moodle.org/503/en/Git_for_Administrators
- Moodle command-line administration: https://docs.moodle.org/503/en/Administration_via_command_line
- Moodle plugin CI: https://github.com/moodlehq/moodle-plugin-ci
- Moodle community discussion of staging and production data: https://moodle.org/mod/forum/discuss.php?d=385118
