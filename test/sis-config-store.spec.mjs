import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

function freshImport(specifierPath) {
  const url = pathToFileURL(specifierPath)
  return import(`${url.href}?t=${Date.now()}-${Math.random()}`)
}

function makeTempConfigPaths() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-config-store-"))
  return {
    tempDir,
    sisConfigPath: path.join(tempDir, "SIS_CONFIG.json"),
    legacyPath: path.join(tempDir, "runtime-data", "admin-ui-settings.json"),
  }
}

const SCHOOL_SETUP_FALLBACK = {
  schoolYear: "2026-2027",
  startDate: "2026-02-21",
  endDate: "2027-01-24",
  quarters: [
    { quarter: "q1", startDate: "2026-02-21", endDate: "2026-05-15" },
    { quarter: "q2", startDate: "2026-05-16", endDate: "2026-08-07" },
    { quarter: "q3", startDate: "2026-08-08", endDate: "2026-10-31" },
    { quarter: "q4", startDate: "2026-11-01", endDate: "2027-01-24" },
  ],
  schoolSetupState: "ok",
}

const SCHOOL_PROFILE_FALLBACK = {
  schoolName: "The Eagles Club",
  bilingualTextVi: "Vietnamese text block",
  bilingualTextEn: "English text block",
  motto: "Serious English",
  mission: "Sứ Mệnh",
  values: "The Eagles American English Club giá trị cốt lõi",
  address: "28 Đường Số 30, Phường An Lạc, Thành Phố Hồ Chí Minh 71906",
  phone: "0937667818",
  publicSite: "https://eagles.edu.vn",
  privateLessonSite: "https://anhngu.eagles.edu.vn",
  webPresence: "https://ielts.eagles.edu.vn",
  socialIm: "Zalo: 84937667818",
  businessTaxId: "0315358180",
  timeFormat: "24hr",
  timeZone: "Asia/Ho_Chi_Minh",
  googleMapsEmbedIframe: "https://maps.example.invalid/embed",
  logoDataUrl: "web-asset/images/logo.svg",
}

const LEVEL_TILE_FALLBACK = {
  "Eggs & Chicks": { title: "Eggs & Chicks", bgColor: "#e0162b", imageDataUrl: "web-asset/images/eggs-chicks.svg" },
  "Pre-A1 Starters": { title: "Pre-A1 Starters", bgColor: "#FCAB15", imageDataUrl: "web-asset/images/starters.svg" },
  "A1 Movers": { title: "A1 Movers", bgColor: "#913198", imageDataUrl: "web-asset/images/movers.svg" },
  "A2 Flyers": { title: "A2 Flyers", bgColor: "#b5d570", imageDataUrl: "web-asset/images/flyers.svg" },
  "A2 KET": { title: "A2 KET", bgColor: "#038e9f", imageDataUrl: "web-asset/images/ket.svg" },
  "B1 PET": { title: "B1 PET", bgColor: "#cd1637", imageDataUrl: "web-asset/images/pet.svg" },
}

function writeRichSisConfigFixture(filePath, { updatedAt = "2026-05-01T00:00:00.000Z", updatedBy = "config" } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      uiSettings: {
        multiSchool: true,
        schoolSetup: {
          ...SCHOOL_SETUP_FALLBACK,
        },
        schoolProfile: {
          ...SCHOOL_PROFILE_FALLBACK,
        },
        levelTileStylesByLevel: {
          ...LEVEL_TILE_FALLBACK,
        },
        newsReportValidation: {},
        queueHub: {},
      },
      runtime: {
        databaseUrl: "postgresql://user:pass@localhost:5432/sis",
      },
      newsReports: {
        weeklyMinimumReports: 5,
      },
      updatedAt,
      updatedBy,
    }, null, 2),
    "utf8",
  )
}

test("saveSisConfigSnapshot writes config and legacy mirror", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const saved = await mod.saveSisConfigSnapshot(
      {
        uiSettings: {
          multiSchool: true,
          schoolSetup: SCHOOL_SETUP_FALLBACK,
          levelTileStylesByLevel: {
            "A1 Movers": {
              title: "Class level title",
              bgColor: "#002786",
              imagePath: "",
            },
          },
        },
        runtime: {
          databaseUrl: "postgresql://user:pass@localhost:5432/sis",
          sessionDriver: "redis",
        },
        newsReports: {
          weeklyMinimumReports: 5,
        },
      },
      "tester",
    )

    assert.equal(saved.uiSettings.multiSchool, true)
    assert.equal(saved.runtime.sessionDriver, "redis")
    assert.equal(saved.newsReports.weeklyMinimumReports, 5)
    assert.equal(saved.uiSettings.levelTileStylesByLevel["A1 Movers"].title, "Class level title")
    assert.equal(fs.existsSync(sisConfigPath), true)
    assert.equal(fs.existsSync(legacyPath), true)

    const configJson = JSON.parse(fs.readFileSync(sisConfigPath, "utf8"))
    const legacyJson = JSON.parse(fs.readFileSync(legacyPath, "utf8"))
    assert.equal(configJson.uiSettings.schoolSetup.schoolYear, "2026-2027")
    assert.equal(configJson.runtime.databaseUrl, "postgresql://user:pass@localhost:5432/sis")
    assert.equal(configJson.newsReports.weeklyMinimumReports, 5)
    assert.equal(configJson.uiSettings.levelTileStylesByLevel["A1 Movers"].bgColor, "#002786")
    assert.equal(legacyJson.uiSettings.schoolSetup.schoolYear, "2026-2027")
    assert.equal(legacyJson.updatedBy, "tester")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("sis config loader fails fast on placeholder example database hosts with line and column", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    fs.mkdirSync(path.dirname(sisConfigPath), { recursive: true })
    fs.writeFileSync(
      sisConfigPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            ...SCHOOL_SETUP_FALLBACK,
          },
        },
        runtime: {
          databaseUrl: "postgresql://example:secret@db.example.test:5432/sis_dev?schema=public",
        },
        newsReports: {
          weeklyMinimumReports: 5,
        },
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "config",
      }, null, 2),
      "utf8",
    )

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const matchesPlaceholderConfigError = (error) => {
      assert.match(String(error?.message || error), /SIS_CONFIG\.json:\d+:\d+/)
      assert.match(String(error?.message || error), /example\.\* hosts are not allowed/)
      return true
    }

    assert.throws(() => mod.getSisConfigSnapshotSync(), matchesPlaceholderConfigError)
    await assert.rejects(() => mod.ensureSisConfigLoaded({ refresh: true }), matchesPlaceholderConfigError)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("sis config loader reinjects relative logo and six level image paths when missing", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    fs.mkdirSync(path.dirname(sisConfigPath), { recursive: true })
    fs.writeFileSync(
      sisConfigPath,
      JSON.stringify({
        uiSettings: {
          multiSchool: false,
          schoolSetup: {
            ...SCHOOL_SETUP_FALLBACK,
          },
          schoolProfile: {
            schoolName: "The Eagles Club",
            logoDataUrl: "",
          },
          levelTileStylesByLevel: {},
          newsReportValidation: {},
          queueHub: {},
        },
        runtime: {
          databaseUrl: "postgresql://user:pass@localhost:5432/sis",
        },
        newsReports: {
          weeklyMinimumReports: 5,
        },
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "config",
      }, null, 2),
      "utf8",
    )

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const snapshot = await mod.ensureSisConfigLoaded({ refresh: true })

    assert.equal(snapshot.uiSettings.schoolProfile.logoDataUrl, "web-asset/images/logo.svg")
    assert.equal(snapshot.uiSettings.schoolProfile.schoolName, "The Eagles Club")
    assert.equal(snapshot.uiSettings.schoolProfile.phone, "")
    assert.equal(snapshot.uiSettings.schoolProfile.publicSite, "")
    assert.equal(snapshot.uiSettings.schoolProfile.googleMapsEmbedIframe, "")
    assert.deepEqual(Object.keys(snapshot.uiSettings.levelTileStylesByLevel).sort(), [
      "A1 Movers",
      "A2 Flyers",
      "A2 KET",
      "B1 PET",
      "Eggs & Chicks",
      "Pre-A1 Starters",
    ])
    assert.equal(
      snapshot.uiSettings.levelTileStylesByLevel["Eggs & Chicks"].imageDataUrl,
      "web-asset/images/eggs-chicks.svg",
    )
    assert.equal(
      snapshot.uiSettings.levelTileStylesByLevel["Pre-A1 Starters"].imageDataUrl,
      "web-asset/images/starters.svg",
    )
    assert.equal(
      snapshot.uiSettings.levelTileStylesByLevel["A1 Movers"].imageDataUrl,
      "web-asset/images/movers.svg",
    )
    assert.equal(
      snapshot.uiSettings.levelTileStylesByLevel["A2 Flyers"].imageDataUrl,
      "web-asset/images/flyers.svg",
    )
    assert.equal(
      snapshot.uiSettings.levelTileStylesByLevel["A2 KET"].imageDataUrl,
      "web-asset/images/ket.svg",
    )
    assert.equal(
      snapshot.uiSettings.levelTileStylesByLevel["B1 PET"].imageDataUrl,
      "web-asset/images/pet.svg",
    )

    const restoredConfig = JSON.parse(fs.readFileSync(sisConfigPath, "utf8"))
    assert.equal(
      restoredConfig.uiSettings.schoolProfile.logoDataUrl,
      "web-asset/images/logo.svg",
    )
    assert.equal(
      restoredConfig.uiSettings.levelTileStylesByLevel["A2 Flyers"].imageDataUrl,
      "web-asset/images/flyers.svg",
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("ensureSisConfigLoaded restores the config snapshot when it is present", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    fs.mkdirSync(path.dirname(sisConfigPath), { recursive: true })
    fs.writeFileSync(
      sisConfigPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            schoolYear: "2025-2026",
            startDate: "2025-08-10",
            endDate: "2026-05-28",
            quarters: [],
            schoolSetupState: "maintenance",
          },
        },
        runtime: {
          databaseUrl: "postgresql://config-only",
        },
        newsReports: {
          weeklyMinimumReports: 5,
        },
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "config",
      }),
      "utf8",
    )
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            ...SCHOOL_SETUP_FALLBACK,
          },
        },
        updatedAt: "2026-06-01T00:00:00.000Z",
        updatedBy: "legacy",
      }),
      "utf8",
    )

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const snapshot = await mod.ensureSisConfigLoaded({ refresh: true })

    assert.equal(snapshot.uiSettings.schoolSetup.schoolYear, "2025-2026")
    assert.equal(snapshot.updatedBy, "config")
    assert.equal(snapshot.runtime.databaseUrl, "postgresql://config-only")
    assert.equal(snapshot.newsReports.weeklyMinimumReports, 5)

    const restoredConfig = JSON.parse(fs.readFileSync(sisConfigPath, "utf8"))
    const restoredLegacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"))
    assert.equal(restoredConfig.uiSettings.schoolSetup.schoolYear, "2025-2026")
    assert.equal(restoredLegacy.uiSettings.schoolSetup.schoolYear, "2025-2026")
    assert.equal(restoredLegacy.updatedBy, "config")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("ensureSisConfigLoaded recreates a missing SIS config from the DB mirror shape", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        uiSettings: {
          multiSchool: true,
          schoolSetup: {
            ...SCHOOL_SETUP_FALLBACK,
          },
          schoolProfile: {
            ...SCHOOL_PROFILE_FALLBACK,
          },
          levelTileStylesByLevel: {
            ...LEVEL_TILE_FALLBACK,
          },
          newsReportValidation: {},
          queueHub: {},
        },
        updatedAt: "2026-06-01T00:00:00.000Z",
        updatedBy: "legacy",
      }, null, 2),
      "utf8",
    )

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const snapshot = await mod.ensureSisConfigLoaded({ refresh: true })

    assert.equal(snapshot.source, "legacy")
    assert.equal(snapshot.uiSettings.schoolProfile.schoolName, "The Eagles Club")
    assert.equal(snapshot.uiSettings.schoolProfile.logoDataUrl, "web-asset/images/logo.svg")
    assert.equal(snapshot.uiSettings.levelTileStylesByLevel["A2 KET"].imageDataUrl, "web-asset/images/ket.svg")
    assert.equal(fs.existsSync(sisConfigPath), true)

    const restoredConfig = JSON.parse(fs.readFileSync(sisConfigPath, "utf8"))
    assert.equal(restoredConfig.uiSettings.schoolProfile.phone, "0937667818")
    assert.equal(restoredConfig.uiSettings.levelTileStylesByLevel["B1 PET"].imageDataUrl, "web-asset/images/pet.svg")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("ensureSisConfigLoaded recreates a missing legacy mirror from SIS config", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    writeRichSisConfigFixture(sisConfigPath, {
      updatedAt: "2026-05-01T00:00:00.000Z",
      updatedBy: "config",
    })

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const snapshot = await mod.ensureSisConfigLoaded({ refresh: true })

    assert.equal(snapshot.source, "file")
    assert.equal(snapshot.uiSettings.schoolProfile.schoolName, "The Eagles Club")
    assert.equal(snapshot.uiSettings.schoolProfile.logoDataUrl, "web-asset/images/logo.svg")
    assert.equal(snapshot.uiSettings.levelTileStylesByLevel["A1 Movers"].imageDataUrl, "web-asset/images/movers.svg")
    assert.equal(fs.existsSync(legacyPath), true)

    const restoredLegacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"))
    assert.equal(restoredLegacy.uiSettings.schoolProfile.publicSite, "https://eagles.edu.vn")
    assert.equal(restoredLegacy.uiSettings.levelTileStylesByLevel["Eggs & Chicks"].imageDataUrl, "web-asset/images/eggs-chicks.svg")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("ensureSisConfigLoaded backs up a corrupt SIS config before restoring from legacy", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    fs.mkdirSync(path.dirname(sisConfigPath), { recursive: true })
    fs.writeFileSync(sisConfigPath, "{ not-json", "utf8")
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            ...SCHOOL_SETUP_FALLBACK,
          },
        },
        updatedAt: "2026-06-01T00:00:00.000Z",
        updatedBy: "legacy",
      }),
      "utf8",
    )

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const snapshot = await mod.ensureSisConfigLoaded({ refresh: true })

    assert.equal(snapshot.source, "legacy")
    assert.equal(snapshot.uiSettings.schoolSetup.schoolYear, "2026-2027")

    const backupName = fs.readdirSync(tempDir).find((entry) => entry.startsWith("SIS_CONFIG.json.BAK-"))
    assert.ok(backupName, "expected SIS_CONFIG backup to be created")
    assert.equal(fs.readFileSync(path.join(tempDir, backupName), "utf8"), "{ not-json")

    const restoredConfig = JSON.parse(fs.readFileSync(sisConfigPath, "utf8"))
    assert.equal(restoredConfig.uiSettings.schoolSetup.schoolYear, "2026-2027")
    assert.equal(restoredConfig.updatedBy, "legacy")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})

test("ensureSisConfigLoaded backs up a corrupt legacy mirror before restoring from SIS config", async () => {
  const { tempDir, sisConfigPath, legacyPath } = makeTempConfigPaths()
  process.env.SIS_CONFIG_FILE = sisConfigPath
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = legacyPath
  process.env.DATABASE_URL = ""

  try {
    fs.mkdirSync(path.dirname(sisConfigPath), { recursive: true })
    fs.writeFileSync(
      sisConfigPath,
      JSON.stringify({
        uiSettings: {
          schoolSetup: {
            ...SCHOOL_SETUP_FALLBACK,
          },
        },
        runtime: {
          databaseUrl: "postgresql://config-only",
        },
        newsReports: {
          weeklyMinimumReports: 5,
        },
        updatedAt: "2026-05-01T00:00:00.000Z",
        updatedBy: "config",
      }),
      "utf8",
    )
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true })
    fs.writeFileSync(legacyPath, "{ not-json", "utf8")

    const mod = await freshImport(path.resolve("src/modules/admin/sis-config-store.mjs"))
    const snapshot = await mod.ensureSisConfigLoaded({ refresh: true })

    assert.equal(snapshot.source, "file")
    assert.equal(snapshot.runtime.databaseUrl, "postgresql://config-only")
    assert.equal(snapshot.uiSettings.schoolSetup.schoolYear, "2026-2027")

    const backupName = fs.readdirSync(path.dirname(legacyPath)).find((entry) => entry.startsWith("admin-ui-settings.json.BAK-"))
    assert.ok(backupName, "expected legacy backup to be created")
    assert.equal(fs.readFileSync(path.join(path.dirname(legacyPath), backupName), "utf8"), "{ not-json")

    const restoredLegacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"))
    assert.equal(restoredLegacy.uiSettings.schoolSetup.schoolYear, "2026-2027")
    assert.equal(restoredLegacy.updatedBy, "config")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.SIS_CONFIG_FILE
    delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    delete process.env.DATABASE_URL
  }
})
