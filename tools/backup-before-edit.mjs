#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  console.error("Usage: node tools/backup-before-edit.mjs <file> [<file> ...]");
  process.exit(1);
}

const files = process.argv.slice(2).filter(Boolean);
if (!files.length) usage();

const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "")
  .replace("T", "-");
const backupRoot = path.resolve("/home/eagles/dockerz/backups/manual-edits", timestamp);

await fs.mkdir(backupRoot, { recursive: true });

for (const input of files) {
  const source = path.resolve(input);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat || !stat.isFile()) {
    console.error(`[skip] not a file: ${input}`);
    continue;
  }
  const rel = path.relative(process.cwd(), source);
  const backupPath = path.join(backupRoot, `${rel}.BAK-${timestamp}`);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(source, backupPath);
  console.log(`[ok] ${rel} -> ${path.relative(process.cwd(), backupPath)}`);
}
