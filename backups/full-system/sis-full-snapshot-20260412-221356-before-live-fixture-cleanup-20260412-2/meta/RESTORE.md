# Restore Guide

Run from source root:

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh --snapshot-dir "/home/eagles/dockerz/sis/backups/full-system/sis-full-snapshot-20260412-221356-before-live-fixture-cleanup-20260412-2" --yes
```

Use `--skip-files` or `--skip-db` for partial restore.
