# local_sisquizsync

Moodle local plugin that observes quiz submissions and forwards the final result to SIS.

For the temporary v2 target, set Moodle's SIS endpoint URL to `https://test.eagles.edu.vn/api/exercise-submission`. Do not point this plugin at `admin.eagles.edu.vn`; that host is the v1 SIS path and is separate.

## Source of truth

- Edit this plugin in the SIS repository.
- Deploy it into the live Moodle tree at `/home/moodle.eagles.edu.vn/app/local/sisquizsync/`.
- Do not hand-edit the live Moodle copy as the primary workflow.

## Deployment

Use `tools/deploy-moodle-plugin.sh` to mirror the repo copy into Moodle and run the Moodle CLI upgrade and cache purge.
If Moodle upgrades or scheduled tasks fail because the live cron wrapper, update wrapper, or configured `pathtophp` drift away from the expected PHP 8.2 CLI path, run `npm run ops:moodle:php:check` first. The default check validates the Moodle-local selectors without requiring the host-wide `php` command to change.
