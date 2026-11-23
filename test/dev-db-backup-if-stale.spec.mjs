import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BACKUP_FRESHNESS_MS,
  DEV_DATABASE_NAME,
  assertDevBackupEnvironment,
  assessBackupFreshness,
  ensurePrivateBackupDirectory,
  runDevBackupIfStale,
} from "../tools/dev-db-backup-if-stale.mjs";

const developmentEnvironment = {
  NODE_ENV: "development",
  SIS_ENV_FILE: ".env.dev",
  DOTENV_CONFIG_PATH: ".env.dev",
  DATABASE_URL: "postgresql://dev-only.example/sis_dev",
};

function backupMetadata(
  directory,
  createdAt,
  { filename = "postgres-dev.dump", sizeBytes = 8, verified = true } = {},
) {
  const backupPath = path.join(directory, filename);
  return {
    createdAt: new Date(createdAt).toISOString(),
    backupFile: filename,
    backupPath,
    outputDir: directory,
    checksumSha256: "a".repeat(64),
    sizeBytes,
    verified,
  };
}

test("dev backup environment requires the exact development env tuple and database URL", () => {
  assert.doesNotThrow(() => assertDevBackupEnvironment(developmentEnvironment));
  for (const change of [
    { NODE_ENV: "test" },
    { SIS_ENV_FILE: ".env.test" },
    { DOTENV_CONFIG_PATH: ".env" },
    { DATABASE_URL: "" },
  ]) {
    assert.throws(() =>
      assertDevBackupEnvironment({ ...developmentEnvironment, ...change }),
    );
  }
});

test("backup freshness requires a verified recent archive at the dev-owned path", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sis-dev-backup-freshness-"),
  );
  try {
    const dumpPath = path.join(directory, "postgres-dev.dump");
    await fs.writeFile(dumpPath, "verified", { mode: 0o600 });
    const stat = await fs.lstat(dumpPath);
    const nowMs = Date.now();
    const fresh = assessBackupFreshness({
      metadata: backupMetadata(directory, nowMs - BACKUP_FRESHNESS_MS + 1000),
      dumpStat: stat,
      directory,
      nowMs,
    });
    assert.equal(fresh.fresh, true);
    assert.equal(fresh.reason, "fresh");

    const stale = assessBackupFreshness({
      metadata: backupMetadata(directory, nowMs - BACKUP_FRESHNESS_MS - 1000),
      dumpStat: stat,
      directory,
      nowMs,
    });
    assert.equal(stale.fresh, false);
    assert.equal(stale.reason, "backup_stale");

    const unverified = assessBackupFreshness({
      metadata: backupMetadata(directory, nowMs, { verified: false }),
      dumpStat: stat,
      directory,
      nowMs,
    });
    assert.equal(unverified.fresh, false);
    assert.equal(unverified.reason, "backup_not_verified");

    const wrongSize = assessBackupFreshness({
      metadata: backupMetadata(directory, nowMs, { sizeBytes: 7 }),
      dumpStat: stat,
      directory,
      nowMs,
    });
    assert.equal(wrongSize.fresh, false);
    assert.equal(wrongSize.reason, "backup_file_missing_or_size_mismatch");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("dev backup guard repairs permissions and creates only for sis_dev when stale", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sis-dev-backup-guard-"),
  );
  try {
    await fs.chmod(directory, 0o755);
    const oldDump = path.join(directory, "old.dump");
    await fs.writeFile(oldDump, "old", { mode: 0o644 });
    const oldMetadata = backupMetadata(
      directory,
      Date.now() - BACKUP_FRESHNESS_MS - 1000,
      { filename: "old.dump", sizeBytes: 3 },
    );
    await fs.writeFile(
      path.join(directory, "latest.json"),
      JSON.stringify(oldMetadata),
      { mode: 0o644 },
    );

    let queried = 0;
    let backedUp = 0;
    const result = await runDevBackupIfStale({
      environment: developmentEnvironment,
      directory,
      queryDatabase: async () => {
        queried += 1;
        return DEV_DATABASE_NAME;
      },
      runBackup: async (outputDirectory) => {
        backedUp += 1;
        const filename = "new.dump";
        const dumpPath = path.join(outputDirectory, filename);
        await fs.writeFile(dumpPath, "new archive");
        const metadata = backupMetadata(outputDirectory, Date.now(), {
          filename,
          sizeBytes: Buffer.byteLength("new archive"),
        });
        await fs.writeFile(
          path.join(outputDirectory, "latest.json"),
          JSON.stringify(metadata),
        );
      },
    });

    assert.deepEqual(
      { status: result.status, reason: result.reason },
      { status: "created", reason: "backup_stale" },
    );
    assert.equal(queried, 1);
    assert.equal(backedUp, 1);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    for (const name of await fs.readdir(directory)) {
      assert.equal(
        (await fs.stat(path.join(directory, name))).mode & 0o777,
        0o600,
      );
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("fresh dev backup skips database access and wrong database identity fails closed", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sis-dev-backup-current-"),
  );
  try {
    const filename = "current.dump";
    const dumpPath = path.join(directory, filename);
    await fs.writeFile(dumpPath, "archive");
    const metadata = backupMetadata(directory, Date.now(), {
      filename,
      sizeBytes: 7,
    });
    await fs.writeFile(
      path.join(directory, "latest.json"),
      JSON.stringify(metadata),
    );
    let queries = 0;
    const fresh = await runDevBackupIfStale({
      environment: developmentEnvironment,
      directory,
      queryDatabase: async () => {
        queries += 1;
        return DEV_DATABASE_NAME;
      },
      runBackup: async () => assert.fail("fresh backup must not be repeated"),
    });
    assert.equal(fresh.status, "fresh");
    assert.equal(queries, 0);

    await fs.writeFile(path.join(directory, "latest.json"), "invalid metadata");
    let backups = 0;
    await assert.rejects(
      runDevBackupIfStale({
        environment: developmentEnvironment,
        directory,
        queryDatabase: async () => "sis-test",
        runBackup: async () => {
          backups += 1;
        },
      }),
      /database_identity_mismatch/u,
    );
    assert.equal(backups, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("dev database health unit runs the pinned backup freshness guard before its read-only check", async () => {
  const unit = await fs.readFile(
    new URL("../ops/systemd/user/sis-db-health-dev.service", import.meta.url),
    "utf8",
  );
  const installer = await fs.readFile(
    new URL("../tools/install-dev-db-health-timer.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    unit,
    /ExecStartPre=-\/home\/eagles\/\.nvm\/versions\/node\/v22\.22\.1\/bin\/node --import dotenv\/config tools\/dev-db-backup-if-stale\.mjs/u,
  );
  assert.match(unit, /Environment=NODE_ENV=development/u);
  assert.match(unit, /Environment=SIS_ENV_FILE=\.env\.dev/u);
  assert.match(unit, /Environment=DOTENV_CONFIG_PATH=\.env\.dev/u);
  assert.match(
    unit,
    /--expected-database sis_dev --backup-latest \/home\/eagles\/dockerz\/backups\/postgres-dev\/latest\.json/u,
  );
  assert.doesNotMatch(
    unit,
    /\/home\/(?:admin|test)\.eagles\.edu\.vn|EnvironmentFile=.*\.env(?:\s|$)/u,
  );
  assert.match(installer, /dev-db-backup-if-stale\.mjs/u);
  assert.match(installer, /--property=ExecStartPre/u);
});
