# SIS Service Workspace

Standalone SIS backend workspace extracted from `megs`.

## Run

```bash
cd /home/eagles/dockerz/sis
npm install
EXERCISE_MAILER_HOST=127.0.0.1 EXERCISE_MAILER_PORT=8787 npm start
```

If `8787` is already in use, pick another port:

```bash
EXERCISE_MAILER_PORT=18877 npm start
```

## Structure

- `server/` HTTP service and SIS routes
- `prisma/` schema + migrations
- `schemas/` intake schema + student import template (`.xlsx`)
- `web-asset/admin/student-admin.html` admin GUI
- `tools/` DB backup/restore tools
- `deploy/nginx/sis-reverse-proxy.conf` reverse proxy reference

## Database

- Uses `DATABASE_URL` from `.env`
- Prisma config: `prisma.config.ts`
- Migrate:

```bash
npm run db:migrate:deploy
```

## Notes

- Admin and intake APIs are under the same service (`server/exercise-mailer.mjs`).
- Existing test suite in this workspace has auth-expectation drift (legacy bearer-token checks vs session auth).
