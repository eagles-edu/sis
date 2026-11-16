---
description: "Fix every instance of one lint rule in a file in a single pass"
name: "Fix Lint Rule"
argument-hint: "Rule ID and file, for example: no-undef web-asset/admin/library-review-workbench.js"
agent: "agent"
---
Fix every instance of one lint rule in one file, in a single pass.

Inputs: the rule ID and the file path, taken from the user's message or the attached problem.

1. Read and follow [AGENTS.md](../../AGENTS.md) before making any changes.
2. Pick the matching validator from the file type:
   - `.js`, `.mjs` under `server`, `test`, `tools`: `npx eslint --config eslint.config.mjs <file>`
   - `.html` admin/parent/student portal pages: `npx html-validate <file>`
   - `.css` or `<style>` blocks in portal HTML: `npx stylelint --config stylelint.config.mjs <file>`
   - `.md`: check the rule against `.markdownlint.json`. If no markdownlint runner is installed, stop and ask. Do not install one.
3. Run the validator on the file and list every match of the rule ID. Use that list as the complete scope.
4. Fix all listed matches with the smallest change that satisfies the rule. Do not change other rules or unrelated lines.
5. Re-run the same validator on the file and confirm zero matches of that rule remain.
6. Report: the rule ID, the file, the number of matches fixed, and the validator output after the fix.

Hard requirements:
- Scope is every match of the given rule in the given file. Do not fix a sample.
- If the rule conflicts with an established repo contract (see AGENTS.md), stop and ask instead of disabling the rule.
- Do not add eslint-disable, html-validate-disable, or stylelint-disable comments to make the rule pass.
