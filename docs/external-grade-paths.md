# External SIS grade and exercise paths

Status: current inventory, reviewed 2026-11-24. This file tracks systems outside SIS that can submit grades or exercise results, plus the adjacent Moodle user-provisioning flow. SIS-owned grade entry is outside this inventory.

All test submissions target `https://test.eagles.edu.vn`. A GET or invalid-signature response proves routing and handler protection only; it does not prove accepted grade creation. Never use real learner submissions as synthetic test data. Record authenticated synthetic writes and exact cleanup separately.

## Inventory

| Source | Active client/configuration | Observed current route | Test-mirror route | Verification and status |
| --- | --- | --- | --- | --- |
| IELTS exercise pages | `/home/ielts.eagles.edu.vn/public_html`; 362 HTML files with 1,436 exercise-submission path references | All 1,436 references now name `https://test.eagles.edu.vn/api/exercise-submission`; the previous live IELTS/Thuvien hosts, relative path, and embedded loopback path were removed from this client set | `https://test.eagles.edu.vn/api/exercise-submission` | Browser opened `exercise-14-either-neither.html`; its inline configuration contains the test target. An empty JSON POST returned test SIS `400` JSON `Missing eaglesId`; no grade write occurred. |
| Thuvien reading exercises | Source: `/home/eagles/dockerz/efast-copy/js/{sis-comprehension-submit.js,sis-exercise-submit.js,sis-cloze-submit.js}`; runtime: corresponding files under `/home/thuvien.eagles.edu.vn/public_html/reading/js/`; 3 scripts referenced by 10,731 HTML pages | Live-page fallback now targets the test SIS. Local development keeps its `127.0.0.1:8786` route and the test host branch stays on the test mirror | `https://test.eagles.edu.vn/api/exercise-submission` | All three runtime scripts were changed and their SRI hashes updated on all 10,731 referencing pages. Browser opened comprehension page `comp365.html`; SRI loaded with zero console errors. An empty JSON POST returned `400` JSON `Missing eaglesId`; no grade write occurred. |
| Moodle quiz grade sync | Moodle plugin `integrations/moodle/local/sisquizsync`; runtime settings checked on production and staging Moodle | Both sites report sync enabled and endpoint `/api/exercise-submission`; both have a shared secret configured. The relative endpoint does not identify the SIS host and is unresolved. | `https://test.eagles.edu.vn/api/exercise-submission` | No submission was sent during inventory. Confirm the resolved Moodle HTTP destination and test-owned HMAC configuration before an accepted write. |
| Google Forms grade trigger | `integrations/google-forms/grades.gs`; Apps Script Script Properties `SIS_GRADES_BASE_URL` and `SIS_GRADES_SECRET` | The script appends `/api/integrations/google-forms/grades`; the external Script Property value is not visible in the SIS repository | `https://test.eagles.edu.vn` plus `/api/integrations/google-forms/grades` | Apps Script and Script Properties need an authenticated Google Apps Script inspection. No form was submitted and no external property was changed during this inventory. |

## Adjacent Moodle user provisioning

Moodle `enrol_sis` polls SIS provisioning commands and manages Moodle accounts, rosters, and memberships. It is not a grade feed, so it is tracked separately. Production Moodle and staging Moodle currently have no SIS base URL or provisioning secret configured; both show Dry run enabled. The staging scheduled task is disabled. The isolated staging flow was physically verified against the test mirror on 2026-11-24 with signed commands, receipts, and idempotency replay; synthetic records were removed and the staging protections were restored afterward (KA-241 in `docs/keep-alive-plan.md`). Production Moodle was not changed.

For the next authorized staging rehearsal, use the test SIS origin only, a test-owned `MOODLE_SIS_PROVISIONING_SECRET`, bounded synthetic command IDs, Dry run off only for the scoped run, and keep the scheduled task disabled. Restore the stage URL/secret and Dry run/task protections after cleanup. Never use the production Moodle user manager to poll test data.

## Change and proof log

| Date | Change or evidence | Result |
| --- | --- | --- |
| 2026-11-24 | Redirected the active IELTS and Thuvien exercise clients to the test mirror and physically checked public pages and test validation | All discovered IELTS references and all three Thuvien submit fallbacks target the test mirror; SRI and browser loading pass. A malformed request received a test SIS validation error without creating a grade. |
| 2026-11-24 | Read-only Moodle and Forms runtime review | Moodle quiz sync is enabled on live and staging Moodle, but both stored endpoints are relative `/api/exercise-submission` and neither stored key matches the test-owned quiz-sync key. Google Apps Script Script Properties remain unverified. Do not mark those routes redirected or physically tested yet. |
| 2026-11-24 | Moodle user-manager route review | Live and staging `enrol_sis` base URL and secret are unset, Dry run is enabled, and the staging task is disabled. The isolated staging user-provisioning path already passed the signed test-mirror lifecycle at KA-241 and was reset afterward. Production Moodle was not changed. |
