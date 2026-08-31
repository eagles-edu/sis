# Tech stack

## Runtime and language

- Node.js: `22.22.1` (as declared in `package.json`)
- JavaScript: ESM modules (`"type": "module"`)
- Primary runtime entrypoint: `server/exercise-mailer.mjs`

## Data and persistence

- PostgreSQL via Prisma ORM
- Prisma schema in `prisma/schema.prisma`
- Prisma client configured with a Postgres adapter pattern in `src/infra/db/prisma-client.mjs`
- Runtime config and database URL resolution are centralized through `src/modules/admin/sis-config-store.mjs`
- Optional Redis session support is present in the runtime config model and session lifecycle configuration

## HTTP and server runtime

- Bare Node HTTP server (`http.createServer`) is used for the main service rather than Express/Hono/Koa
- Route logic is centralized in `server/student-admin-routes.mjs`
- Cookie-based authentication and session handling are a first-class part of admin and portal flows

## UI stack

- Plain HTML + CSS + JavaScript portal surfaces
- Shared portal styling in `web-asset/shared/portal-theme.css`
- Generated/minified portal assets are managed alongside source HTML and CSS
- No React/Vue/Angular single-page frontend framework is evident in the current repo structure

## Libraries and services

- Prisma ORM and PostgreSQL client integration
- `nodemailer` for email delivery
- `pdfkit` for report-card PDF generation
- `xlsx` for spreadsheet import/export workflows
- `cheerio` and parsing utilities for content processing
- `redis` for optional session/cache support
- `sharp`-style image assets are not core here; the app uses portal asset storage and generated asset management
- `cmu-pronouncing-dictionary` for pronunciation/syllable validation

## Testing and quality tooling

- Node.js built-in test runner (`node --test`)
- Playwright for browser-authenticated portal tests
- JSDOM for DOM-grade tests
- ESLint for JS validation
- HTML validation for portal markup
- Stylelint for CSS linting
- TypeScript compile check via `tsc -p tsconfig.json`

## Build and deployment tooling

- Custom project scripts for admin asset generation and sync/restart tasks
- NGINX config under `deploy/nginx/` for test mirror traffic
- Runtime sync scripts under `tools/` for local dev/test/live mirror operations
- No application-level Dockerfile was found for the app itself; the deployment model is a Node service behind NGINX with environment-specific runtime config

## Summary

This is a pragmatic, infrastructure-aware Node.js application built around Prisma and PostgreSQL, with static portal HTML frontends and custom operational tooling. The stack favors explicit control, runtime scripts, and environment-specific config management over framework-managed conventions.
