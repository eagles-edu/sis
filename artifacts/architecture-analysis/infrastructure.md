# Infrastructure

## Runtime infrastructure

- Node.js service running as the application backend
- PostgreSQL as the canonical data store
- Optional Redis for session or cache-backed runtime behavior
- NGINX acting as an edge proxy and static asset host in the deployment setup

## Deployment topology

The deployment config in `deploy/nginx/test.eagles.edu.vn.conf` shows a proxied pattern for the public site and API:

- public web root under `/home/test.eagles.edu.vn/public_html`
- test runtime upstream on `127.0.0.1:8086` for web assets
- API runtime on `127.0.0.1:8786` for portal/admin API
- HTTPS terminates at NGINX with origin-aware CORS rules

This indicates a split between:

- static/public-facing HTML assets,
- server-side app runtime,
- edge proxy containing security and routing rules.

## Config and environment management

The application uses per-environment runtime contracts:

- `.env.dev` for development
- `.env.test` for test mirror
- `.env` for production/live

The runtime config is also persisted as `SIS_CONFIG.json` and mirrored into DB-backed config stores. This is a deliberate environment-control system and a key modernization concern.

## Operational tooling

The repo contains scripts for:

- dev/test/live sync and restarts,
- DB backup and restore,
- file sync across mirror roots,
- portal sync proofs,
- Lighthouse audit checks,
- runtime health verification.

This is operational infrastructure, not just application code, and it is central to day-to-day service reliability.

## Containerization

A direct app Dockerfile was not found in the repo root. The project seems designed to run as a host-managed Node service with NGINX, not as a Docker-first deployment.

A separate language-tool Dockerfile exists in `infra/languagetool/Dockerfile`, but it is a supporting service rather than the main app container.

## Key infrastructure dependencies

- PostgreSQL database connection through Prisma
- Redis sessions/cache (optional but configured in schema)
- NGINX routing and caching edge
- SMTP/email provider integration (Brevo)
- file-backed sync and runtime restore tooling
- portal asset generation and deployment parity checks

## Infrastructure conclusion

The app is structured as a traditional, self-hosted web application with an edge proxy and a DB-backed runtime. The infrastructure is operationally mature but sensitive to environment-specific drift, mirror sync correctness, and config parity across dev/test/live copies.
