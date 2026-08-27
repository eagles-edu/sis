# 13-source suitability-score reference matrix

## CANONICAL Dictionary Builder scoring (CDBS), controls, and export

### Summary

Use `docs/SCORING-PLAN.md` as the scoring authority, with `PERFECT_DIC_PLAN_V1.5.md` retaining control of Builder UI, first-pass, and Apply rules. Create thirteen independently scored sources: LD, OA, OB, BR, MW API, MW scrape, ET, WK, CA, TH, WH, GT, and GL.

Add a physical, separately loaded protected page at `/admin/library/definitions`. It is the Dictionary Builder settings and scoring page; it must not load into the main admin application or the Builder modal.

### Scoring model

- The source tables in `SCORING-PLAN.md` and `docs/up-scrape.md` (`### Complete POS and current dropdown
  contract`).become the automatic per-datum quality matrix, with all fourteen POS rows and these columns: Vietnamese,
  Syllable / Stress, Number of syllables, POS classifications (include enhanced classes in adjectives, pronouns,
  conjunctions, pronouns, determiners, adverbs per plan docs/up-scrape.md ### Complete POS and current dropdown
  contract), other POS-specific data (e.g., stems, verb forms, comparatives-superlatives, participles as nouns, ed/ing
adjectives, etc.); Audio, Definition Proper, Examples from web/corpus, First known use, path to english, etymology, Works Cited.
- No administrator seeds the base matrix manually. Generate its initial value from the availability matrix:
  - `0.00` when not offered;
  - `0.75` when one enabled source offers the datum;
  - `0.60` when two enabled sources offer it;
  - `0.50` when three or more enabled sources offer it.
- MW API and MW scrape count as two offerings for scarcity calculations.
- Apply initial quality values: GT Vietnamese `0.90`; WH Syllable / Stress and Number of syllables `0.75`; ET History / origin `0.85` and conditionally offered non-history datum `0.10`; MW API and MW scrape First known use `0.85`.
- Calculate current suitability as the equal mean of:
  1. automatic per-datum quality;
  2. network availability;
  3. per-datum accepted-choice rate;
  4. provider coverage of applicable needed datums for the selected POS.
- Use neutral `0.20` for unavailable history components. Recompute derived current scores whenever the page, BIC selection, or export is requested; preview and Apply counters continuously refine future results.
- Preserve the mandatory first-pass MW API call. MW scrape is separately tracked and selected by BIC only for an eligible unresolved datum.

### Definitions page and data interfaces

- Add `/admin/library/definitions` to the Library Administration menu. Serve its own HTML and dedicated client asset, with the standard protected admin shell and no main-app bundle dependency.
- Add protected read APIs for the current thirteen-source matrix, BIC order, score components, availability/acceptance counters, and effective provider controls.
- Add admin-only write APIs for non-secret provider controls:
  - provider enablement;
  - POS/datum eligibility restrictions;
  - preference overrides above the automatic base score;
  - per-provider timeout, concurrency, and request-rate limits.
- Never expose or edit provider credentials on this page. A setting may restrict a manifest capability but cannot enable a datum known unavailable in the availability matrix.
- Persist controls and score observations in the Library schema. Keep separate  `merriam_webster` counters and begin separate, truthful metrics for `merriam_webster_api` and `merriam_webster_scrape`.
- Add `GET /api/admin/library/definitions/matrix.xlsx` as a server-generated download. The workbook contains a current-score sheet for each of the thirteen sources, a BIC sheet, and a settings/components sheet. It never accepts client-supplied rows.

### Documentation changes

- Correct `SCORING-PLAN.md` to say thirteen sources, “MW scrape,” and automatic quality values rather than administrator-seeded scores.
- Remove the incorrect statement that a conditional score can override a known-unavailable `0.00`.
- Update V1.5 to link to `SCORING-PLAN.md` as scoring authority and explicitly preserve its existing API-first MW rule, 12-link public source matrix, and non-operational Builder matrix rule.

### Verification

- Unit-test automatic scarcity values, fixed overrides, four-component score calculation, disabled/forbidden capability behavior, and separate MW API/scrape metrics.
- Route-test admin read/write/export authorization, teacher read-only behavior, no credential exposure, and XLSX sheet/column/value correctness.
- Verify the standalone Definitions page loads directly, is linked under Library Administration, does not add requests to the main admin page, and exports the current calculated matrix.

