#!/usr/bin/env node
// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  closeSharedPrismaClient,
  getSharedPrismaClient,
} from "../src/infra/db/prisma-client.mjs";

export const DEV_DATABASE_NAME = "sis_dev";
export const DEV_ENV_FILE = ".env.dev";
export const DEV_BACKUP_DIRECTORY = "/home/eagles/dockerz/backups/postgres-dev";
export const BACKUP_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const REPOSITORY_ROOT = "/home/eagles/dockerz/sis";

const EXPECTED_ENVIRONMENT = Object.freeze({
  NODE_ENV: "development",
  SIS_ENV_FILE: DEV_ENV_FILE,
  DOTENV_CONFIG_PATH: DEV_ENV_FILE,
});

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment
 */
export function assertDevBackupEnvironment(environment) {
  for (const [name, expected] of Object.entries(EXPECTED_ENVIRONMENT)) {
    if (environment[name] !== expected) {
      const error = new Error("dev_environment_mismatch");
      error.name = "DevBackupEnvironmentError";
      throw error;
    }
  }
  if (!String(environment.DATABASE_URL || "").trim()) {
    const error = new Error("dev_database_url_missing");
    error.name = "DevBackupEnvironmentError";
    throw error;
  }
}

/**
 * @param {{ metadata: unknown, dumpStat: import('node:fs').Stats | null, directory: string, nowMs?: number, maxAgeMs?: number }} input
 * @returns {{ fresh: boolean, reason: string, ageMs: number | null }}
 */
export function assessBackupFreshness({
  metadata,
  dumpStat,
  directory,
  nowMs = Date.now(),
  maxAgeMs = BACKUP_FRESHNESS_MS,
}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { fresh: false, reason: "metadata_missing_or_invalid", ageMs: null };
  }

  const value = /** @type {Record<string, unknown>} */ (metadata);
  const backupFile =
    typeof value.backupFile === "string" ? value.backupFile : "";
  if (!backupFile || path.basename(backupFile) !== backupFile) {
    return { fresh: false, reason: "backup_filename_invalid", ageMs: null };
  }

  const expectedDirectory = path.resolve(directory);
  const expectedBackupPath = path.join(expectedDirectory, backupFile);
  if (
    path.resolve(String(value.outputDir || "")) !== expectedDirectory ||
    path.resolve(String(value.backupPath || "")) !== expectedBackupPath
  ) {
    return { fresh: false, reason: "backup_path_mismatch", ageMs: null };
  }
  if (
    value.verified !== true ||
    !/^[a-f0-9]{64}$/iu.test(String(value.checksumSha256 || ""))
  ) {
    return { fresh: false, reason: "backup_not_verified", ageMs: null };
  }
  if (
    !dumpStat?.isFile() ||
    !Number.isSafeInteger(Number(value.sizeBytes)) ||
    Number(value.sizeBytes) < 1 ||
    Number(value.sizeBytes) !== dumpStat.size
  ) {
    return {
      fresh: false,
      reason: "backup_file_missing_or_size_mismatch",
      ageMs: null,
    };
  }

  const timestamp = Date.parse(String(value.createdAt || ""));
  if (!Number.isFinite(timestamp) || timestamp > nowMs) {
    return { fresh: false, reason: "backup_timestamp_invalid", ageMs: null };
  }

  const ageMs = nowMs - timestamp;
  if (ageMs > maxAgeMs) return { fresh: false, reason: "backup_stale", ageMs };
  return { fresh: true, reason: "fresh", ageMs };
}

/**
 * @param {string} directory
 */
export async function ensurePrivateBackupDirectory(
  directory = DEV_BACKUP_DIRECTORY,
) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await fs.lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error("backup_directory_invalid");
  }
  await fs.chmod(directory, 0o700);

  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const entryStat = await fs.lstat(entryPath);
    if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
      throw new Error("backup_directory_contains_unsupported_entry");
    }
    await fs.chmod(entryPath, 0o600);
  }
}

async function readLatestBackup(directory, nowMs) {
  const latestPath = path.join(directory, "latest.json");
  let latestStat;
  try {
    latestStat = await fs.lstat(latestPath);
  } catch {
    return { fresh: false, reason: "latest_metadata_missing", ageMs: null };
  }
  if (latestStat.isSymbolicLink() || !latestStat.isFile()) {
    return { fresh: false, reason: "latest_metadata_invalid", ageMs: null };
  }

  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(latestPath, "utf8"));
  } catch {
    return { fresh: false, reason: "latest_metadata_invalid", ageMs: null };
  }

  const backupFile =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? String(metadata.backupFile || "")
      : "";
  if (!backupFile || path.basename(backupFile) !== backupFile) {
    return assessBackupFreshness({
      metadata,
      dumpStat: null,
      directory,
      nowMs,
    });
  }

  let dumpStat = null;
  try {
    const backupPath = path.join(directory, backupFile);
    const candidate = await fs.lstat(backupPath);
    if (!candidate.isSymbolicLink()) dumpStat = candidate;
  } catch {
    dumpStat = null;
  }
  return assessBackupFreshness({ metadata, dumpStat, directory, nowMs });
}

async function queryCurrentDatabase() {
  const prisma = await getSharedPrismaClient();
  try {
    const rows = await prisma.$queryRaw`SELECT current_database() AS name`;
    return String(rows?.[0]?.name || "");
  } finally {
    await closeSharedPrismaClient();
  }
}

async function executeBackup(directory) {
  const scriptPath = path.join(REPOSITORY_ROOT, "tools/db-backup-failsafe.mjs");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "dotenv/config",
      scriptPath,
      "--output-dir",
      directory,
      "--retention-days",
      "30",
      "--keep-min",
      "14",
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        ...EXPECTED_ENVIRONMENT,
      },
      stdio: "inherit",
    },
  );

  await new Promise((resolve, reject) => {
    child.once("error", () => reject(new Error("backup_process_start_failed")));
    child.once("close", (code, signal) => {
      if (code === 0) resolve(undefined);
      else
        reject(
          new Error(
            signal ? "backup_process_signaled" : "backup_process_failed",
          ),
        );
    });
  });
}

/**
 * @param {{ environment?: NodeJS.ProcessEnv | Record<string, string | undefined>, directory?: string, nowMs?: () => number, queryDatabase?: () => Promise<string>, runBackup?: (directory: string) => Promise<void> }} [options]
 */
export async function runDevBackupIfStale(options = {}) {
  const environment = options.environment || process.env;
  const directory = path.resolve(options.directory || DEV_BACKUP_DIRECTORY);
  const nowMs = options.nowMs || (() => Date.now());
  assertDevBackupEnvironment(environment);
  await ensurePrivateBackupDirectory(directory);

  const current = await readLatestBackup(directory, nowMs());
  if (current.fresh) {
    return { status: "fresh", reason: current.reason, ageMs: current.ageMs };
  }

  const currentDatabase = await (
    options.queryDatabase || queryCurrentDatabase
  )();
  if (currentDatabase !== DEV_DATABASE_NAME) {
    throw new Error("database_identity_mismatch");
  }

  await (options.runBackup || executeBackup)(directory);
  await ensurePrivateBackupDirectory(directory);
  const updated = await readLatestBackup(directory, nowMs());
  if (!updated.fresh) throw new Error("backup_result_not_fresh_and_verified");
  return { status: "created", reason: current.reason, ageMs: updated.ageMs };
}

async function main() {
  process.umask(0o077);
  try {
    const result = await runDevBackupIfStale();
    console.log(
      `[dev-db-backup] status=${result.status} reason=${result.reason}`,
    );
  } catch {
    console.error(
      "[dev-db-backup] refresh failed; database health check will still run and report backup freshness",
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
