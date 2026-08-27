import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  discardLibraryAudio,
  downloadLibraryAudio,
  finalizeLibraryAudio,
  libraryMediaRoot,
  validateLibraryAudioUrl,
  validateLdoceAudioUrl,
} from "../src/modules/admin/library-media.mjs"

test("protected media accepts only HTTPS approved dictionary audio hosts", () => {
  assert.equal(validateLdoceAudioUrl("https://www.ldoceonline.com/media/english/breProns/test.mp3"), "https://www.ldoceonline.com/media/english/breProns/test.mp3")
  assert.equal(validateLibraryAudioUrl("https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/w/wor/word_/word__us_1.mp3", "oxford"), "https://www.oxfordlearnersdictionaries.com/media/american_english/us_pron/w/wor/word_/word__us_1.mp3")
  assert.throws(() => validateLdoceAudioUrl("http://www.ldoceonline.com/test.mp3"), /not allowed/)
  assert.throws(() => validateLdoceAudioUrl("https://evil.example/test.mp3"), /not allowed/)
  assert.throws(() => validateLibraryAudioUrl("https://www.ldoceonline.com/test.mp3", "oxford"), /not allowed/)
})

test("audio download uses an atomic outside-webroot checksum path and rejects bad MIME", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sis-library-media-"))
  const previousRoot = process.env.SIS_LIBRARY_MEDIA_ROOT
  process.env.SIS_LIBRARY_MEDIA_ROOT = root
  const content = Buffer.from("fake mp3 bytes")
  const expectedSha = crypto.createHash("sha256").update(content).digest("hex")
  const response = { ok: true, status: 200, url: "https://www.ldoceonline.com/media/english/breProns/test.mp3", headers: new Headers({ "content-type": "audio/mpeg", "content-length": String(content.length) }), arrayBuffer: async () => content }
  let download
  try {
    download = await downloadLibraryAudio({ sourceUrl: response.url, entryId: "entry-1", dialect: "uk", fetchImpl: async () => response })
    assert.equal(download.sha256, expectedSha)
    assert.equal(download.storagePath, `ldoce/${expectedSha}.mp3`)
    assert.equal(path.dirname(download.finalPath), path.join(root, "ldoce"))
    await finalizeLibraryAudio(download)
    assert.deepEqual(await fs.readFile(download.finalPath), content)
    const badMime = { ...response, headers: new Headers({ "content-type": "text/html" }) }
    await assert.rejects(() => downloadLibraryAudio({ sourceUrl: response.url, entryId: "entry-1", dialect: "us", fetchImpl: async () => badMime }), /did not return an MP3/)
  } finally {
    await discardLibraryAudio(download)
    if (previousRoot === undefined) delete process.env.SIS_LIBRARY_MEDIA_ROOT
    else process.env.SIS_LIBRARY_MEDIA_ROOT = previousRoot
    await fs.rm(root, { recursive: true, force: true })
  }
  assert.equal(libraryMediaRoot().includes("sis-library-media"), true)
})
