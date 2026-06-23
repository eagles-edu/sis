# Normalize Shared Theme, Then Rebase `grades-tabulator`

## Summary
Centralize the remaining dark-mode surface/text/link semantics in `portal-theme.css`, then rework `grades-tabulator.html` to consume only shared theme roles and shared chrome primitives. The goal is to remove page-owned color behavior, not to keep multiplying aliases or page-local near-duplicates.

## Key Changes
- Tighten the shared theme registry in [`web-asset/shared/portal-theme.css`](/home/eagles/dockerz/sis/web-asset/shared/portal-theme.css):
  - Keep canonical neutral, surface, text, and link tokens.
  - Preserve semantic-only accent tokens where they are truly distinct.
  - Use nearest-neighbor matching first: if an existing shared semantic token or class is close enough for the role, use it instead of creating a page-specific alias.
  - Collapse duplicate dark-mode aliases so they point at the shared semantic roles instead of introducing more per-page variants.
- Normalize [`web-asset/admin/grades-tabulator.html`](/home/eagles/dockerz/sis/web-asset/admin/grades-tabulator.html):
  - Replace local dark-mode color ownership with shared classes and shared tokens.
  - Reuse the shared header bar, header content, footer, content width, panel/card/table shell patterns already defined by the portal theme.
  - Leave page-local CSS only for layout, spacing, sizing, and Tabulator-specific behavior, not color semantics.
  - Remove any remaining page-local `color`, `background`, `border-color`, and dark-mode overrides that duplicate the shared theme.
- Keep the shared theme as the source of truth:
  - Do not add more `--portal-color-*` style escape hatches for page-local literals.
  - Do not recreate page-local `:root` token systems, dark/light alias layers, or near-duplicate semantic ladders on a page.
  - If a value is needed across pages and no acceptable shared role already exists, promote it to a shared semantic token or shared class once, then consume it everywhere.

## Test Plan
- Update contract coverage in [`test/portal-theme-contract.spec.mjs`](/home/eagles/dockerz/sis/test/portal-theme-contract.spec.mjs):
  - Assert `grades-tabulator.html` uses only shared theme classes for the shell/header/footer/surfaces.
  - Assert no new page-local dark-mode color blocks are introduced for that page.
- Extend surface-token checks in [`test/live-theme-surface-tokens.spec.mjs`](/home/eagles/dockerz/sis/test/live-theme-surface-tokens.spec.mjs):
  - Verify the normalized grades page reads from shared surface/text/link roles.
  - Verify it does not rely on page-local palette literals for the shared UI chrome.
- Rebuild the shared CSS artifact and restart the dev runtime after edits, then verify the page and the contract suite pass.

## Assumptions
- `grades-tabulator.html` is the first page to be untangled in this pass; other pages stay untouched unless they block shared-theme parity.
- Semantic accents that are not part of the neutral dark surface ladder may remain if they are genuinely shared semantics, not duplicated page-local variants.
- Adding one or two shared tokens is acceptable when the gap is real; wholesale token creation for a single page is not.
- Page-local CSS is allowed to remain for structure and behavior, but not for independent color systems.
