# Project structure

## High-level shape

This repository is a single-service SIS application focused on student administration, parent/student portals, and operational workflows. The codebase is organized as a Node.js ESM service with a large shared route layer and domain modules, along with static portal HTML/CSS/JS assets and a Prisma-backed PostgreSQL data model.

## Root layout

- `server/` — runtime entrypoints and route handlers for administration, portals, and service endpoints.
- `src/` — domain logic and reusable modules; this is the main business-layer code.
- `src/modules/` — feature modules such as student roster, enrollment, assignment templates, points, library, intake, portal preferences, and async jobs.
- `src/infra/` — infrastructure helpers, including Prisma connection management and observability hooks.
- `prisma/` — Prisma schema and migrations.
- `web-asset/` — admin, parent, student, shared portal assets, and generated/static UI artifacts.
- `test/` — Node test suite and Playwright/browser validation specs.
- `tools/` — operational scripts for dev/test sync, backup/restore, build steps, and runtime checks.
- `deploy/` — NGINX and runtime deployment config.
- `config/` — local config and contract fixtures.
- `runtime-data/` — runtime payloads and mirrored settings.

## Runtime entrypoints

- `server/exercise-mailer.mjs` — main service bootstraps environment, loads config, initializes portal assets, and wires the app server.
- `server/student-admin-routes.mjs` — the biggest route surface; contains admin portal endpoints, portal routing, session flows, and data access orchestration.
- `server/student-admin-store.mjs` — student-admin persistence layer integration for the admin workspace.

## Domain organization

The primary feature areas are split into focused modules under `src/modules/`:

- `admin/` — roster, admissions, attendance, grades, performance, news review, library corpus, users, school setup, queue hub, notifications.
- `portal/` — portal preferences and assets.
- `exercises/` — exercise intake, matching, and submission persistence.
- `intake/` — student intake pipelines.
- `async/` — background job processing and side effects.
- `email/` — Brevo email integration and delivery tracking.

## UI architecture

- `web-asset/admin/` — admin shell and standalone admin surfaces.
- `web-asset/parent/` — parent portal pages.
- `web-asset/student/` — student portal pages and library UI.
- `web-asset/shared/` — reusable portal theme and cross-page CSS tokens.

## Operational pattern

This is a monolithic service with modular feature boundaries rather than a microservice split. The app uses:

- a shared Prisma client for DB access,
- cookie/session-based portal auth,
- server-rendered or HTML-backed portal surfaces,
- script-driven asset sync and deployment checks,
- generated admin UI assets and a mirrored runtime config store.

## Architectural conclusion

The project is best characterized as a full-stack, stateful SIS service with a strongly coupled server route layer and a mixed HTML/JS portal UI. The architecture is not a Java/Spring or frontend SPA framework; it is a pragmatic Node + Prisma + static-asset system designed around operational school workflows.
