# Authenticated portal performance SOP

This is the required procedure for any performance, boot, loading, flash, LCP, or network-order conclusion on `/admin`, `/parent`, or `/student`.

## Non-negotiable distinction

The standard `npm run audit:lighthouse:portals` command is a clean-profile, unauthenticated Lighthouse gate. Its 100/100 result proves the public/login shell and clean-profile third-party consent boundary only. It does not prove authenticated portal boot, dashboard hydration, authenticated LCP, or absence of a loading flash.

An authenticated conclusion requires a real browser session created through the visible portal login form. Static inspection, an API login, injected cookies, a copied storage state, or a direct Lighthouse URL is not full-auth browser proof.

## Required flow

The flow under test is: portal route -> visible login form -> successful UI login -> authenticated route reload -> first meaningful shell and data render.

1. Read `AGENTS.md`, `docs/CODE-EDITING-DOCS-INDEX.md`, `docs/sop.md`, `README.md`, `sis.md`, `docs/DOCUMENT-STATUS-AND-PARAMETER-AUDIT.md`, `docs/CORE-DESIGN-PARAMETERS.md`, and the affected portal surface contract before browser work.
2. Use the environment-owned file for the target: `.env.dev` for dev, `.env.test` for the test mirror, and `.env` for the live/admin mirror. Parse it without shell-sourcing quoted JSON values. Never print credentials or student PII.
3. Launch Chrome/Chromium with Playwright at both `1440x900` desktop and `390x844` mobile viewports.
4. Open the target route, fill the visible username/password controls, submit the visible form, and wait for the authenticated application panel. Do not replace this with a `fetch()` login or cookie injection.
5. After the UI login settles, reload the same route in the same browser context. Capture the state at `domcontentloaded`, then wait for the authenticated shell and first data surface.
6. Record, without exposing secrets:
   - URL and title;
   - auth marker, body visibility, login-panel visibility, and application-panel visibility at `domcontentloaded`;
   - screenshot of the first viewport;
   - console errors and failed requests;
   - request/resource order and counts for the authenticated dashboard APIs;
   - LCP, CLS, and the LCP element when available;
   - optional third-party resources, especially Brevo, relative to shell paint and LCP.
7. Compare test and live only after collecting the same evidence with the same route, viewport, browser executable, login flow, and consent state.
8. Run the focused student boot gate from the repository:

   ```text
   npm run test:student:performance
   ```

   For a mirror, set `SIS_ENV_FILE` and `STUDENT_PORTAL_PERF_ORIGIN` explicitly before invoking the test file. Do not use a bare Prisma command or a cross-environment fallback.

## Student boot acceptance criteria

An authenticated student boot passes only when all of the following are true for desktop and mobile:

- the final URL is the authenticated `/student` route;
- the authenticated marker is present;
- the login panel is hidden and `#appPanel` is visible;
- the body is no longer hidden after boot and the identity shell is not a loading placeholder;
- `/api/student/dashboard` is requested exactly once per authenticated reload;
- Brevo and other optional third-party resources do not enter the critical path before LCP;
- there are no unexpected console errors or failed application requests;
- LCP is finite and within the local authenticated gate (`4000ms` unless the surface contract sets a tighter limit);
- the first viewport has no visible flash, clipping, overlap, or layout shift that the screenshots contradict.

The clean-profile Lighthouse gate and the authenticated Playwright gate are complementary. A passing clean-profile Lighthouse score cannot waive any authenticated criterion above. An authenticated Lighthouse JSON report is diagnostic evidence only unless it was preceded by the full visible-login browser flow and its consent state is recorded.

## Diagnosis and repair order

When test and live differ under the same source sync:

1. Verify served source/generated/runtime/public hashes and the runtime restart before blaming the browser.
2. Verify the auth state and consent persistence. A first-visit consent panel, an acknowledged consent record, and an active Brevo widget are different performance states.
3. Compare the authenticated request waterfall. Duplicate dashboard calls, optional vendor chains before LCP, and dashboard work that waits before revealing the shell are boot defects.
4. Repair the canonical dev source, rebuild generated assets, restart dev, and rerun the focused authenticated gate.
5. Sync only through the explicitly authorized environment workflow, then repeat the same authenticated desktop/mobile proof on the mirror.

## Evidence and reporting

Keep screenshots, traces, and temporary browser captures outside the repository unless a committed artifact is explicitly requested. Report the environment, route, viewport, browser path, auth method, consent state, request counts, LCP/CLS, console/request failures, and remaining risk. Never report a clean-profile 100/100 as authenticated portal proof.
