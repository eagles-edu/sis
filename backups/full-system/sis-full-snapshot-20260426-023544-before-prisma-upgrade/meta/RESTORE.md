# Restore Guide

Run from source root:

```bash
cd /home/eagles/dockerz/sis
tools/sis-full-restore-snapshot.sh --snapshot-dir "/home/eagles/dockerz/sis/backups/full-system/sis-full-snapshot-20260426-023544-before-prisma-upgrade" --yes
```

Use `--skip-files` or `--skip-db` for partial restore.
