# Deployment

## Deployment model

This repository is designed as a self-hosted Node.js application rather than a container-first microservice. It uses:

- a Node service runtime,
- NGINX as the edge/proxy layer,
- PostgreSQL as the persistent database,
- environment-specific runtime config and mirror management.

## NGINX-based routing

`deploy/nginx/test.eagles.edu.vn.conf` demonstrates the intended production-style proxy model:

- public site served from `/home/test.eagles.edu.vn/public_html`
- app upstreams on `127.0.0.1:8786` and `127.0.0.1:8086`
- route handling for `/admin`, `/parent`, `/student`, and static assets
- CORS rules bounded to allowed `eagles.edu.vn` origins
- security headers and gzip/brotli compression controls

## Environment-sensitive deployment flow

The repo explicitly aligns runtime behavior with environment ownership:

- `.env.dev` for local development,
- `.env.test` for test mirror,
- `.env` for live/admin runtime.

It also manages mirrored runtime config via `SIS_CONFIG.json`, which indicates deployed runtime config is treated as authoritative for that environment and must be kept in sync with the DB-backed source of truth.

## Asset and sync work

The deployment process is operationally driven by scripts in `tools/` such as:

- sync-and-restart runtimes,
- portal sync proof,
- admin asset rebuild,
- test-runtime sync and validation.

This indicates a workflow where generated UI assets and runtime files are explicitly synchronized and validated rather than handled implicitly.

## Containerization status

No production app Dockerfile was found in the main application root. The service is deployed as a host-managed Node app behind NGINX and other runtime infrastructure rather than a Docker/Kubernetes-first pattern.

## Deployment risks

- drift between source and deployed copies,
- config drift between environment-owned files,
- route-level mismatches during public/admin portal sync,
- asset parity issues across test/live mirrors.

## Deployment summary

The project deploys as a traditional, environment-aware Node web app with NGINX routing and a strong emphasis on runtime parity. Deployment safety depends on explicit environment ownership, config synchronization, and thorough portal test coverage.
