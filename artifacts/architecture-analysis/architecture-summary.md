# Architecture summary

## Overall architecture

The application follows a classic monolithic backend pattern with feature-oriented modules and a structured HTML portal frontend. There is no service mesh or microservice decomposition; instead, the app is a single runtime with multiple domain modules and environment-specific config.

## Layering

1. Runtime entrypoint and HTTP handling
   - `server/exercise-mailer.mjs` bootstraps config and the HTTP server.
   - `server/student-admin-routes.mjs` handles the application’s route and API surface.

2. Business logic modules
   - `src/modules/*` encapsulates student admin, attendance, reports, portal management, intake, and async side effects.
   - These modules orchestrate Prisma queries and business rules rather than exposing raw DB access directly.

3. Data access layer
   - `src/infra/db/prisma-client.mjs` centralizes Prisma initialization and connection reuse.
   - The app avoids multiple ad hoc DB clients by using a shared singleton pattern per runtime configuration.

4. UI layer
   - Portal pages are static HTML/CSS/JS assets served through the same service.
   - They are not a separate runtime app; they are authored in the repo and served through the Node server and NGINX proxy setup.

## Control flow patterns

- Environment config is loaded at boot and routed through runtime-config resolution.
- The admin/student/parent flows are browser-facing and session-backed.
- Many operations are database-driven and depend on stored configuration such as school setup, portal preferences, and queue settings.
- Background jobs are modeled as persisted async side effects, not ad hoc ad hoc cron tasks.

## Coupling and domain boundaries

The system is intentionally integrated:

- admin routes pull from many domain modules in one handler file,
- many modules share the same `Student` and `SchoolSetup` domain objects,
- configuration and portal behavior are coupled to runtime state and mirrored data,
- the app’s route file becomes a central orchestrator for a broad operational domain.

This means the architecture is maintainable in the short term, but the central route file and shared config schema are major upgrade vectors. Migration or modernization work should treat the route surface as a dependency hub rather than as isolated feature modules.

## Key architectural strengths

- Clear feature modularity within `src/modules/`
- Shared DB access abstraction via Prisma
- Explicit environment/config handling for dev/test/prod
- Strong operational tooling for backups, sync, and runtime verification
- Rich stored business-state support for school workflows

## Key architectural risks

- Route file size and breadth of responsibilities in `server/student-admin-routes.mjs`
- High feature coupling across admin/student/parent workflows
- Heavy reliance on stored runtime config and mirrored settings
- Static portal assets and server-side route logic are interdependent at runtime
- Large number of persisted workflow states and edge conditions amplifies migration risk

## Migration-readiness conclusion

The app is a system-of-record SIS, not a simple CRUD service. Modernization should prioritize:

- config consistency and environment isolation,
- database migration safety and data mapping,
- route-level decoupling for large modules,
- portal asset parity across dev/test/live copies,
- validation of browser-authenticated regression paths.
