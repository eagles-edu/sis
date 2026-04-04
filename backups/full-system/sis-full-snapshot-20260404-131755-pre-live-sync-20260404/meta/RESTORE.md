# Restore Guide

Run from source root:

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh --snapshot-dir "/home/eagles/dockerz/sis/backups/full-system/sis-full-snapshot-20260404-131755-pre-live-sync-20260404" --yes
```

Use `--skip-files` or `--skip-db` for partial restore.
