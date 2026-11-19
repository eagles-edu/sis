# Student News Report Validation

This document defines the intended permissive validation contract for student media report submissions.

Primary rule:

- always save the form submission
- validation must never block save
- non-passing validation marks the report for revision and returns guidance

Primary runtime surfaces:

- `POST /api/student/news-reports`
- `web-asset/student/student-portal.html`
- `src/modules/admin/student-news-compliance.mjs`

## Save Contract

Validation is advisory for review workflow, not a hard submit gate.

Required behavior:

- the server always persists the submitted form payload
- if validation passes, save as normal and continue success flow
- if validation does not pass, still save the report
- non-passing reports are marked for revision or re-review
- the response returns field guidance, warnings, and revision tasks

This means:

- `save` and `validation pass` are separate outcomes
- a validation miss must not reject or discard the form

## Validation Model

Use two categories only:

- `required-to-save`
- `warning-only`

`required-to-save` means:

- field must contain data
- if missing, the report is still saved, but marked for revision

`warning-only` means:

- field may be weak, partial, or below similarity target
- the report is still saved
- the field is flagged for follow-up guidance only

## Allowed Sources

Preferred CURRENTLY approved sources:

- `cnn.com`
- `bbc.com`

Custom sources:

- up to `8` enabled custom domains may be added in settings

Source-domain mismatches:

- should not block save
- should mark the report for revision with source guidance

## Shared Normalization

All fields are trimmed before validation.

`sourceLink` should:

- be a full `http/https` URL
- point to a specific article, not a homepage

Similarity scoring may still be used for guidance, but low similarity should not block save.

### Optional vocabulary etymology

- Origin type and word-origin note are optional and never block saving.
- A row with both fields supplied is a completed optional etymology contribution and must not receive an improvement warning.
- If a student supplies only one field, Check may suggest only the missing companion field; it must not ask students to re-enter information already present.
- Etymology attempt and extra-point metadata remain separate from warning-only guidance.

## Field Contract

### `sourceLink`

Max length:

- `2048`

Required-to-save:

- should contain data
- should be a parseable `http/https` URL
- hostname is not on the approved list
- sourceLink does not match accepted organization such as `bbc` or `cnn`

Warning-only:

- source metadata fetch fails
- URL is not specific enough to the article

Expected guidance:

- use a full article URL
- use an approved source
- recheck the exact story link

### `articleTitle`

Max length:

- `240`

Required-to-save:

- should contain data

Warning-only:

- title does not closely match fetched source title

Preferred similarity target:

- `0.7`

Notes:

- below-threshold title similarity should produce revision guidance
- below-threshold title similarity should not block save

### `byline`

Max length:

- `240`

Required-to-save:

- must contain data

Warning-only:

- byline does not closely match fetched author

Preferred similarity target:

- `0.7`

Notes:

- organization fallback remains valid
- blank byline is a revision condition, not a save blocker

### `articleDateline`

Max length:

- `240`

Required-to-save:

- must contain data

Warning-only:

- dateline similarity is below target
- visible `Updated` text is not reflected
- timezone wording is incomplete
- GMT/UTC offset is missing
- relative time is imprecise but still usable

Preferred similarity target:

- `0.6`

Relaxed acceptance signals:

- relative-time inputs are within `24 hours`
- extracted calendar date keys overlap
- extracted calendar date keys are within `1 day`
- fetched target is relative and student input is effectively `today`
- fetched target is effectively `today` and student input is effectively `today`

Notes:

- dateline should contain meaningful source date/time data
- dateline mismatch should produce guidance, not submit rejection

### `leadSynopsis`

Max length:

- `5000`

Required-to-save:

- should contain data

Warning-only:

- synopsis does not align strongly enough with the source lead paragraph

Preferred similarity target:

- `0.45`

Notes:

- lead similarity is guidance-grade, not save-gate

### `actionActor`

Max length:

- `2000`

Required-to-save:

- should contain data

Preferred content:

- a clear noun or noun phrase naming who or what performed the action

Warning-only:

- actor phrase is weak, vague, or malformed

Notes:

- weak actor phrasing should not block save

### `actionAffected`

Max length:

- `2000`

Required-to-save:

- should contain data

Preferred content:

- a clear noun or noun phrase naming who or what was affected

Warning-only:

- affected phrase is weak, vague, or malformed

### `actionWhere`

Max length:

- `2000`

Required-to-save:

- should contain data

Preferred content:

- location phrase
- ideally city, country, region, or comparable place reference

Warning-only:

- location is too vague
- location is implied but not explicit

### `actionWhat`

Max length:

- `4000`

Required-to-save:

- must not be blank

Preferred content:

- at least one phrase or sentence describing what happened

Warning-only:

- too short
- incomplete
- not clearly sentence-like

Preferred shape:

- one complete sentence is best, but not mandatory for save

### `actionWhy`

Max length:

- `4000`

Required-to-save:

- should contain data

Preferred content:

- at least one complete sentence explaining why the action happened

Warning-only:

- lacks clear subject/verb logic
- too short
- fragment only
- starts as an incomplete conjunction fragment
- phrased as a question instead of an explanation

### `biasAssessment`

Max length:

- `5000`

Required-to-save:

- should contain data

Preferred content:

- at least one complete sentence evaluating bias, spin, framing, omission, or slant

Warning-only:

- too short
- fragment only
- does not make a real evaluative claim

### `vocabulary`

For each completed row, Check validates the part of speech, English, Vietnamese, syllabication, and definition. Local CMUdict is authoritative for spoken syllable count and primary stress. Merriam-Webster Collegiate is queried before Learner's to verify written division; Merriam-Webster headword asterisks mark word-division boundaries, so those marks must not be mistaken for spoken syllable boundaries when a dictionary-supported pronunciation gives a different split.

The verified spoken syllabication `dem-o-LI-tion` is accepted for `demolition`: it has four syllables and primary stress on `LI`, matching CMUdict and the Merriam-Webster pronunciation, even though Merriam-Webster's headword is shown as `de*mo*li*tion`. A true CMUdict count/stress mismatch remains a required correction. Temporary Merriam-Webster outages remain visible warnings and do not block Check or Submit.

Vocabulary Check feedback must show the failing entry message, score and threshold when present, and each remediation step in the Check modal. Highlight the named row field. Close the hamster animation when the server result arrives, then show the result modal immediately while dashboard/calendar hydration finishes; keep the modal open across hydration when warning-only results exist. A vocabulary error exposes one consent checkbox and an in-app `Submit` action. The request contains only the failed word, entered syllabication, and Check message; the server associates it with the authenticated student. Do not expose an email draft, mailto link, or email action. Staff review requests in Queue Hub and may approve a syllabication override, which Student News checks before dictionary providers.

## Response Contract

When the report is saved:

- the response may include `complianceFailed: false`
- or `complianceFailed: true`

When `complianceFailed: true`:

- the report is still saved
- the report is marked for revision or re-review
- the response should include:
  - `failedFields`
  - `revisionTasks`
  - validation details or warnings

When `complianceFailed: false`:

- the report is saved
- the standard success flow continues

## Revision Guidance

Revision guidance may be returned for:

- `sourceLink`
- `articleTitle`
- `byline`
- `articleDateline`
- `leadSynopsis`
- `actionActor`
- `actionAffected`
- `actionWhere`
- `actionWhat`
- `actionWhy`
- `biasAssessment`

Each guidance entry should include:

- `field`
- `label`
- `steps`
- `criterion`

## Review Workflow Notes

Validation exists to support:

- coaching
- revision loops
- source accuracy
- clearer admin review

Validation does not exist to:

- block student submission
- drop form data
- force resubmission before the initial save

## Current Drift To Watch

If code is stricter than this document, treat that as implementation drift.

Priority drift to avoid:

- rejecting save because similarity is below threshold
- requiring perfect byline/title/dateline matching before save
- treating warning-grade prose quality issues as submit blockers

## Reference Files

- `src/modules/admin/student-news-compliance.mjs`
- `server/student-admin-routes.mjs`
- `web-asset/student/student-portal.html`
- `test/news-compliance.spec.mjs`
