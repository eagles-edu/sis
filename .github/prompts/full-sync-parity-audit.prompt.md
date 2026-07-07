---
description: "Run full backup, purge, dev-to-test mirror sync, parity checks, and portal verification"
name: "Full Sync + Parity Audit"
argument-hint: "Optional scope or constraints (for example: only admin+parent portals, skip PDF fixtures)"
agent: "agent"
---
Execute this end-to-end operational workflow in the current SIS workspace:

1. Read and follow [AGENTS.md](../../AGENTS.md) and [docs/sop.md](../../docs/sop.md) before making any changes.
2. Perform a full backup of the in-scope runtime and sync artifacts.
3. Purge stale/generated artifacts that should not survive into mirror sync.
4. Sync from dev source to test mirror with strict parity rules.
5. Run parity checks on all app/runtime files after sync.
6. Exclude these from parity scope unless explicitly overridden:
   - `.env.*`
   - vhost files
   - settings files
7. Verify operation of all portals after sync:
   - admin
   - parent
   - student
8. Read docs and review all sync-suite files for currency and contract drift.

Hard requirements:
- Fail closed when authoritative data/config is missing.
- Do not use synthetic fallback values.
- Keep scope literal and exhaustive for all in-scope files.
- Do not claim completion until sync + parity + portal verification are all done.

Expected response format:
- `Scope`: exact source and target roots used.
- `Backups`: created/verified backup paths.
- `Purge`: what was removed and why.
- `Sync`: command(s) run and high-level result.
- `Parity`: summary counts and any mismatches.
- `Portal verification`: status for admin/parent/student with key evidence.
- `Sync-suite currency review`: outdated files/contracts and required updates.
- `Drift verdict`: whether drift exists and which copy is newest.
- `Next actions`: minimal follow-up list only if needed.

If any ambiguity remains, ask one concise clarification question before executing.
