import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  sanitizeStudentProfileBackup,
  writeStudentProfileBackupSnapshot,
} from "../src/modules/admin/student-profile-backups.mjs"

test("profile backup snapshots remove plaintext credentials recursively", async () => {
  const originalDirectory = process.env.SIS_PROFILE_BACKUP_DIR
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sis-profile-backup-"))
  process.env.SIS_PROFILE_BACKUP_DIR = directory
  try {
    const sanitized = sanitizeStudentProfileBackup({
      password: "do-not-store",
      passwordHash: "do-not-store",
      profile: { normalizedFormPayload: { password: "also-do-not-store" } },
      firstName: "Test",
    })
    assert.deepEqual(sanitized, {
      profile: { normalizedFormPayload: {} },
      firstName: "Test",
    })

    const result = await writeStudentProfileBackupSnapshot({
      studentRefId: "student-1",
      action: "updated",
      phase: "pre-save",
      actorUsername: "admin",
      actorRole: "admin",
      data: { password: "secret", profile: { name: "Test" } },
    })
    const contents = await fs.readFile(result.path, "utf8")
    assert.match(contents, /student-1/)
    assert.match(contents, /Test/)
    assert.doesNotMatch(contents, /secret/)
    assert.equal((await fs.stat(result.path)).mode & 0o777, 0o600)
  } finally {
    if (originalDirectory === undefined) delete process.env.SIS_PROFILE_BACKUP_DIR
    else process.env.SIS_PROFILE_BACKUP_DIR = originalDirectory
    await fs.rm(directory, { recursive: true, force: true })
  }
})
