import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

export const PORTAL_AUDIT_ARTIFACTS_DIR = path.resolve(process.env.PORTAL_AUDIT_ARTIFACTS_DIR || "/tmp/sis-portal-audit")

export const PORTAL_AUDIT_INIT_SCRIPT = `
  (() => {
    const state = { layoutShifts: [] };
    globalThis.__SIS_PORTAL_AUDIT__ = state;
    if (globalThis.PerformanceObserver) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              state.layoutShifts.push({
                value: entry.value,
                sources: (entry.sources || []).map((source) => ({
                  selector: source.node?.id ? "#" + source.node.id : source.node?.className || source.node?.tagName || "",
                  previousRect: source.previousRect?.toJSON?.() || null,
                  currentRect: source.currentRect?.toJSON?.() || null,
                })),
              });
            }
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        state.observer = observer;
      } catch {
        state.observer = null;
      }
    }
  })();
`

export async function ensureArtifactsDir() {
  await fs.mkdir(PORTAL_AUDIT_ARTIFACTS_DIR, { recursive: true })
}

export async function writeAssetPartitionManifests(audits) {
  const partitionRoot = path.join(PORTAL_AUDIT_ARTIFACTS_DIR, "partitions")
  await fs.mkdir(partitionRoot, { recursive: true })
  const manifest = {
    generatedAt: new Date().toISOString(),
    storageRoot: partitionRoot,
    policy: {
      critical: "Keep in the initial render path; verify before deferring.",
      deferable: "Candidate for delayed loading or route-level storage; do not defer without flow verification.",
      cache: "Use immutable caching only after the URL is content-addressed; otherwise revalidate.",
    },
    partitions: [],
  }
  for (const audit of audits) {
    const portal = String(audit.name || "portal").replace(/-(?:dark-)?(?:desktop|mobile)$/u, "")
    const classification = audit.criticalCoverage?.classification || {}
    for (const [bucket, entries] of Object.entries(classification)) {
      const record = {
        portal,
        viewport: audit.name?.endsWith("mobile") ? "mobile" : "desktop",
        theme: audit.name?.includes("-dark-") ? "dark" : "light",
        bucket,
        entries: entries.map((entry) => ({
          url: entry.url,
          storagePath: entry.storagePath,
          bytes: entry.totalBytes,
          usedBytes: entry.usedBytes,
          usedPercent: entry.usedPercent,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          cachePolicy: entry.cachePolicy,
        })),
      }
      const fileName = `${portal}-${record.viewport}-${record.theme}-${bucket}.json`
      await fs.writeFile(path.join(partitionRoot, fileName), JSON.stringify(record, null, 2), "utf8")
      manifest.partitions.push({ file: fileName, ...record })
    }
  }
  await fs.writeFile(path.join(PORTAL_AUDIT_ARTIFACTS_DIR, "asset-partitions.json"), JSON.stringify(manifest, null, 2), "utf8")
  return manifest
}

export async function collectAxe(page) {
  const axePath = path.resolve("node_modules/axe-core/axe.min.js")
  await page.addScriptTag({ path: axePath })
  return await page.evaluate(async () => {
    const results = await globalThis.axe.run(document, { resultTypes: ["violations"] })
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact || "",
      help: violation.help,
      nodes: violation.nodes.slice(0, 10).map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary || "",
      })),
    }))
  })
}

export async function collectGeometry(page) {
  return await page.evaluate(() => {
    const overflow = []
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.position === "fixed") continue
      let fixedAncestor = element.parentElement
      while (fixedAncestor && fixedAncestor !== document.body) {
        if (getComputedStyle(fixedAncestor).position === "fixed") break
        fixedAncestor = fixedAncestor.parentElement
      }
      if (fixedAncestor && fixedAncestor !== document.body) continue
      let scrollContainer = element.parentElement
      let insideHorizontalScroller = false
      while (scrollContainer && scrollContainer !== document.body) {
        const scrollStyle = getComputedStyle(scrollContainer)
        if (scrollStyle.overflowX === "auto" || scrollStyle.overflowX === "scroll") {
          insideHorizontalScroller = true
          break
        }
        scrollContainer = scrollContainer.parentElement
      }
      if (insideHorizontalScroller) continue
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        overflow.push({
          selector: element.id ? `#${element.id}` : element.className || element.tagName,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        })
      }
    }
    const audit = globalThis.__SIS_PORTAL_AUDIT__ || { layoutShifts: [] }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      overflow: overflow.slice(0, 20),
      layoutShifts: audit.layoutShifts || [],
      cls: (audit.layoutShifts || []).reduce((sum, entry) => sum + Number(entry.value || 0), 0),
    }
  })
}

export async function collectCriticalCoverage(page) {
  const jsCoverage = await page.coverage?.stopJSCoverage?.() || []
  const cssCoverage = await page.coverage?.stopCSSCoverage?.() || []
  const pageModel = await page.evaluate(() => {
    const visibleAboveFold = []
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) continue
      if (element.children.length > 0 && element.textContent?.trim() === "") continue
      visibleAboveFold.push({
        selector: element.id ? `#${element.id}` : element.className || element.tagName,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: Math.round(entry.startTime),
      responseEnd: Math.round(entry.responseEnd),
      transferSize: entry.transferSize || 0,
      decodedBodySize: entry.decodedBodySize || 0,
    }))
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((node) => ({
      href: node.href,
      media: node.media || "all",
      blocking: !node.media || node.media === "all",
    }))
    const scripts = Array.from(document.scripts).map((node) => ({
      src: node.src,
      async: node.async,
      defer: node.defer,
      type: node.type || "classic",
      inHead: Boolean(node.closest("head")),
      blocking: Boolean(node.src && node.closest("head") && !node.async && !node.defer),
    }))
    return { visibleAboveFold: visibleAboveFold.slice(0, 300), resources, styles, scripts }
  })
  const resourceMap = new Map(pageModel.resources.map((resource) => [resource.name, resource]))
  const summarizeCoverage = (entries) => {
    const byUrl = new Map()
    for (const entry of entries) {
      const resource = resourceMap.get(entry.url)
      const totalBytes = entry.text?.length || resource?.decodedBodySize || null
      const usedBytes = (entry.ranges || []).reduce((sum, range) => sum + range.end - range.start, 0)
      const current = byUrl.get(entry.url)
      if (!current || usedBytes > current.usedBytes || totalBytes > (current.totalBytes || 0)) {
        byUrl.set(entry.url, {
          url: entry.url,
          totalBytes,
          usedBytes: Math.max(usedBytes, current?.usedBytes || 0),
          usedPercent: totalBytes ? Math.round((Math.max(usedBytes, current?.usedBytes || 0) / totalBytes) * 1000) / 10 : null,
          ranges: [...(current?.ranges || []), ...(entry.ranges || [])],
        })
      }
    }
    return [...byUrl.values()]
  }
  const javascript = summarizeCoverage(jsCoverage)
  const css = summarizeCoverage(cssCoverage)
  const styleMap = new Map(pageModel.styles.map((style) => [style.href, style]))
  const scriptMap = new Map(pageModel.scripts.filter((script) => script.src).map((script) => [script.src, script]))
  const classify = (entries, map, kind) => entries
    .filter((entry) => entry.url && entry.totalBytes !== null)
    .map((entry) => {
      const resource = resourceMap.get(entry.url)
      const declaration = map.get(entry.url)
      const isDeferredIsland = kind === "js" && (/\.mjs(?:\?|$)/u.test(entry.url) || /island/u.test(entry.url))
      const aboveFoldUsed = entry.usedBytes > 0 || (kind === "js" && !isDeferredIsland)
      const loadedBeforePaint = resource ? resource.startTime < 500 : false
      const blocking = kind === "css"
        ? Boolean(declaration?.blocking && declaration.media === "all")
        : Boolean(declaration?.blocking)
      const isInitialAdminBundle = kind === "js" && /student-admin\.min\.js(?:\?|$)/u.test(entry.url)
      const critical = kind === "js"
        ? aboveFoldUsed && loadedBeforePaint && !isDeferredIsland && (declaration?.inHead || isInitialAdminBundle)
        : aboveFoldUsed && (blocking || loadedBeforePaint)
      return {
        ...entry,
        kind,
        storagePath: resource ? new URL(resource.name).pathname : null,
        cachePolicy: /[?&](?:v|version|hash)=/u.test(entry.url) || /\.[a-f0-9]{8,}\./u.test(entry.url)
          ? "immutable-fingerprinted"
          : "revalidate",
        critical,
        deferable: !critical,
        loadedBeforePaint,
        blocking,
        startTime: resource?.startTime ?? null,
        responseEnd: resource?.responseEnd ?? null,
        usedAboveFoldBytes: aboveFoldUsed ? entry.usedBytes : 0,
      }
    })
  const criticalCss = classify(css, styleMap, "css").filter((entry) => entry.critical)
  const deferableCss = classify(css, styleMap, "css").filter((entry) => entry.deferable)
  const criticalJs = classify(javascript, scriptMap, "js").filter((entry) => entry.critical)
  const deferableJs = classify(javascript, scriptMap, "js").filter((entry) => entry.deferable)
  return {
    ...pageModel,
    javascript,
    css,
    classification: { criticalCss, deferableCss, criticalJs, deferableJs },
  }
}

export async function auditPage(page, { name, url, theme = "light", screenshot = true, axe = true, coverage = true } = {}) {
  const consoleErrors = []
  const failedRequests = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("requestfailed", (request) => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" })
  })

  if (coverage && page.coverage) {
    await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true })
    await page.coverage.startCSSCoverage({ resetOnNavigation: false })
  }
  await page.goto(url, { waitUntil: "load", timeout: 30000 })
  if (theme === "dark") {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"))
  }
  await page.waitForTimeout(1000)
  const geometry = await collectGeometry(page)
  const violations = axe ? await collectAxe(page) : []
  const criticalCoverage = coverage ? await collectCriticalCoverage(page) : null
  const artifactBase = path.join(PORTAL_AUDIT_ARTIFACTS_DIR, name)
  if (screenshot) await page.screenshot({ path: `${artifactBase}.png`, fullPage: false })
  await fs.writeFile(`${artifactBase}.html`, await page.content(), "utf8")

  const result = {
    name,
    url: page.url(),
    title: await page.title(),
    consoleErrors,
    failedRequests,
    geometry,
    criticalCoverage,
    axeViolations: violations,
  }
  await fs.writeFile(`${artifactBase}.json`, JSON.stringify(result, null, 2), "utf8")
  return result
}

export async function runLighthouseJson(url, { preset = "desktop" } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "lighthouse", url, "--preset", preset, "--output=json", "--output-path=stdout", "--quiet", "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage"], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Lighthouse failed (${code}): ${stderr || stdout}`))
      const start = stdout.indexOf("{")
      const end = stdout.lastIndexOf("}")
      if (start < 0 || end <= start) return reject(new Error("Lighthouse returned no JSON"))
      resolve(JSON.parse(stdout.slice(start, end + 1)))
    })
  })
}
