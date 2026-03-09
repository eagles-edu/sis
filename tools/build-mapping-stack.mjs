#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const outDir = path.join(repoRoot, "docs", "mapping", "out")

const args = new Set(process.argv.slice(2))
const depsOnly = args.has("--deps-only")
const openapiOnly = args.has("--openapi-only")

if (depsOnly && openapiOnly) {
  console.error("[map] --deps-only and --openapi-only are mutually exclusive.")
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

function runOrThrow(command, commandArgs, captureStdout = false) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: captureStdout ? ["ignore", "pipe", "pipe"] : "inherit",
  })

  if (captureStdout && result.stderr) process.stderr.write(result.stderr)

  if (result.status !== 0) {
    throw new Error(`[map] command failed (${command} ${commandArgs.join(" ")})`)
  }

  return captureStdout ? result.stdout || "" : ""
}

function runWithInputOrThrow(command, commandArgs, input) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  })

  if (result.stderr) process.stderr.write(result.stderr)

  if (result.status !== 0) {
    throw new Error(`[map] command failed (${command} ${commandArgs.join(" ")})`)
  }

  return result.stdout || ""
}

function rewriteDependencySvgLinks(svg) {
  return svg.replace(/(xlink:href|href)="(server|tools)\//g, '$1="../../../$2/')
}

function writeArtifact(filename, content) {
  const target = path.join(outDir, filename)
  writeFileSync(target, content, "utf8")
  console.log(`[map] wrote ${path.relative(repoRoot, target)}`)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildMappingPortalHtml({ generatedAtIso }) {
  const generatedAt = escapeHtml(generatedAtIso)
  const workflows = [
    {
      id: "system-context",
      label: "System Context",
      path: "../mermaid/system-context.mmd",
      summary: "Client, API, store, DB, cache, and mail-provider boundaries.",
    },
    {
      id: "page-backend-map",
      label: "Page to Backend Map",
      path: "../mermaid/page-backend-map.mmd",
      summary: "UI pages mapped to API endpoints and backend handlers.",
    },
    {
      id: "overview-assignment-flow",
      label: "Overview Assignment Flow",
      path: "../mermaid/overview-assignment-flow.mmd",
      summary: "Dashboard summary flow plus volatile assignment announcement preview.",
    },
  ]

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SIS Mapping Portal</title>
    <style>
      :root {
        --paper: #f4f7f5;
        --ink: #0e2b2d;
        --ink-soft: #375154;
        --accent: #0f8f7a;
        --accent-alt: #d96e0f;
        --line: #c0d4d1;
        --panel: #ffffff;
        --ok: #1b7f3b;
        --warn: #a85d0a;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top right, #d4efe8 0, transparent 42%),
          radial-gradient(circle at 10% 80%, #f9dec8 0, transparent 30%),
          linear-gradient(130deg, #f0f5f3, #f9fbfa);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      .shell {
        max-width: 1320px;
        margin: 0 auto;
        padding: 24px 20px 48px;
      }

      .hero {
        display: grid;
        grid-template-columns: 1.6fr 1fr;
        gap: 16px;
        margin-bottom: 18px;
      }

      .panel {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 14px;
        box-shadow: 0 8px 22px rgba(30, 60, 54, 0.08);
      }

      .hero-main {
        padding: 18px 22px 20px;
        animation: rise 300ms ease-out;
      }

      .hero-main h1 {
        margin: 0 0 8px;
        font-size: 2rem;
        line-height: 1.15;
      }

      .hero-main p {
        margin: 0;
        color: var(--ink-soft);
      }

      .hero-side {
        padding: 16px 18px;
      }

      .meta-row {
        font-family: "JetBrains Mono", "Consolas", monospace;
        font-size: 0.82rem;
        line-height: 1.6;
      }

      .actions {
        margin-top: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .btn {
        display: inline-block;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.9rem;
        border-radius: 9px;
        padding: 7px 12px;
        border: 1px solid transparent;
        transition: transform 160ms ease, background-color 160ms ease, border-color 160ms ease;
      }

      .btn:hover {
        transform: translateY(-1px);
      }

      .btn-main {
        background: var(--accent);
        color: #fff;
      }

      .btn-alt {
        background: #f9efe4;
        color: #7d3f0c;
        border-color: #e4c7a6;
      }

      .btn-subtle {
        background: #eef4f3;
        color: var(--ink);
        border-color: var(--line);
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 18px;
      }

      .stat {
        padding: 11px 12px;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: linear-gradient(160deg, #fbfefd, #f3f8f6);
      }

      .stat-label {
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-soft);
      }

      .stat-value {
        margin-top: 4px;
        font-size: 1.25rem;
        font-weight: 700;
        line-height: 1.15;
      }

      .layout {
        display: grid;
        gap: 16px;
        grid-template-columns: 1.15fr 1fr;
      }

      .section {
        padding: 16px;
      }

      .section h2 {
        margin: 0 0 12px;
        font-size: 1.08rem;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .controls {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }

      .control {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 7px 10px;
        background: #fff;
        color: var(--ink);
        font: inherit;
      }

      .workflow-list {
        list-style: none;
        margin: 0 0 10px;
        padding: 0;
        display: grid;
        gap: 6px;
      }

      .workflow-list button {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 8px 10px;
        text-align: left;
        background: #f4f9f8;
        color: var(--ink);
        cursor: pointer;
      }

      .workflow-list button.active {
        background: #dff5ee;
        border-color: #91c7b6;
      }

      .workflow-summary {
        margin: 0 0 12px;
        font-size: 0.9rem;
        color: var(--ink-soft);
      }

      .diagram {
        border: 1px solid var(--line);
        border-radius: 10px;
        min-height: 280px;
        padding: 10px;
        overflow: auto;
        background: #fff;
      }

      .diagram.raw {
        font-family: "JetBrains Mono", "Consolas", monospace;
        font-size: 0.82rem;
        white-space: pre;
      }

      .caption {
        margin: 8px 0 0;
        font-size: 0.83rem;
        color: var(--ink-soft);
      }

      .dependency-canvas {
        border: 1px solid var(--line);
        border-radius: 10px;
        min-height: 390px;
        overflow: auto;
        background: #fff;
      }

      .dependency-canvas object {
        width: 100%;
        min-height: 390px;
      }

      .table-wrap {
        border: 1px solid var(--line);
        border-radius: 10px;
        overflow: auto;
        margin-top: 10px;
      }

      table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.86rem;
      }

      th, td {
        padding: 8px 10px;
        border-bottom: 1px solid #e8f0ee;
        vertical-align: top;
      }

      th {
        text-align: left;
        background: #edf6f3;
        font-size: 0.78rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      tr:hover td {
        background: #f8fcfb;
      }

      .mono {
        font-family: "JetBrains Mono", "Consolas", monospace;
        font-size: 0.8rem;
      }

      .badge {
        display: inline-block;
        border-radius: 999px;
        padding: 2px 8px;
        border: 1px solid #b7d9cf;
        background: #edf8f5;
        font-size: 0.74rem;
      }

      .badge.warn {
        border-color: #e7cca9;
        background: #fff5ea;
      }

      .detail {
        margin-top: 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px;
        background: #fbfefd;
      }

      .detail h3 {
        margin: 0 0 8px;
        font-size: 0.94rem;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .detail-list {
        margin: 0;
        padding-left: 16px;
      }

      .detail-list li {
        margin: 3px 0;
      }

      .resource-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .resource-list a {
        display: block;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 8px 10px;
        background: #fbfefd;
        color: var(--ink);
        text-decoration: none;
      }

      .resource-list a span {
        color: var(--ink-soft);
        font-size: 0.84rem;
      }

      iframe {
        width: 100%;
        height: 560px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #fff;
      }

      .footer-note {
        margin-top: 14px;
        font-size: 0.78rem;
        color: var(--ink-soft);
      }

      .section-spaced {
        margin-top: 16px;
      }

      .status {
        font-size: 0.82rem;
        color: var(--ok);
      }

      .status.warn {
        color: var(--warn);
      }

      @keyframes rise {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @media (max-width: 1100px) {
        .hero {
          grid-template-columns: 1fr;
        }

        .layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
        .stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .detail-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="panel hero-main">
          <h1>SIS Mapping Portal</h1>
          <p>
            Unified view over architecture context, workflow diagrams, dependency graph, and API contract.
          </p>
          <div class="actions">
            <a class="btn btn-main" href="./dependency-graph.svg" target="_blank" rel="noreferrer">Open Dependency Graph</a>
            <a class="btn btn-alt" href="./sis-admin.openapi.html" target="_blank" rel="noreferrer">Open API Docs</a>
            <a class="btn btn-subtle" href="../structurizr/workspace.dsl" target="_blank" rel="noreferrer">Open Structurizr DSL</a>
            <a class="btn btn-subtle" href="../README.md" target="_blank" rel="noreferrer">Open Mapping README</a>
          </div>
        </div>
        <div class="panel hero-side">
          <div class="meta-row">Generated: <span id="generated-at">${generatedAt}</span></div>
          <div class="meta-row">Workspace: /home/eagles/dockerz/sis</div>
          <div class="meta-row">Artifacts: docs/mapping/out</div>
          <div class="meta-row">Build command: npm run map:all</div>
          <p class="footer-note">
            Tip: open this portal at <code>/docs/mapping/out/</code> for a stable entry point.
          </p>
        </div>
      </section>

      <section class="stats">
        <article class="stat">
          <div class="stat-label">Modules</div>
          <div class="stat-value" id="stat-modules">-</div>
        </article>
        <article class="stat">
          <div class="stat-label">Dependencies</div>
          <div class="stat-value" id="stat-edges">-</div>
        </article>
        <article class="stat">
          <div class="stat-label">Orphans</div>
          <div class="stat-value" id="stat-orphans">-</div>
        </article>
        <article class="stat">
          <div class="stat-label">Most Used Module</div>
          <div class="stat-value" id="stat-top-used">-</div>
        </article>
      </section>

      <section class="layout">
        <article class="panel section">
          <div class="section-header">
            <h2>Workflow Diagrams</h2>
            <div class="controls">
              <label for="workflow-select" class="mono">diagram</label>
              <select id="workflow-select" class="control"></select>
            </div>
          </div>
          <ul class="workflow-list" id="workflow-list"></ul>
          <p class="workflow-summary" id="workflow-summary"></p>
          <div id="workflow-diagram" class="diagram"></div>
          <p class="caption">
            Source: <a id="workflow-source-link" href="#" target="_blank" rel="noreferrer" class="mono"></a>
          </p>
          <p class="status" id="workflow-status"></p>
        </article>

        <article class="panel section">
          <div class="section-header">
            <h2>Artifacts and Workbench</h2>
          </div>
          <ul class="resource-list">
            <li><a href="./dependency-graph.svg" target="_blank" rel="noreferrer"><strong>Dependency Graph (SVG)</strong><br /><span>Interactive graph with node click-through to source files.</span></a></li>
            <li><a href="./dependency-graph.mmd" target="_blank" rel="noreferrer"><strong>Dependency Graph (Mermaid Source)</strong><br /><span>Text source generated from dependency-cruiser.</span></a></li>
            <li><a href="./dependency-graph.json" target="_blank" rel="noreferrer"><strong>Dependency Graph (JSON)</strong><br /><span>Machine-readable modules and edges.</span></a></li>
            <li><a href="./sis-admin.openapi.html" target="_blank" rel="noreferrer"><strong>SIS Admin OpenAPI</strong><br /><span>Rendered API reference using Redocly.</span></a></li>
            <li><a href="../openapi/sis-admin.openapi.yaml" target="_blank" rel="noreferrer"><strong>OpenAPI Source YAML</strong><br /><span>Authoritative API contract input.</span></a></li>
            <li><a href="../structurizr/workspace.dsl" target="_blank" rel="noreferrer"><strong>Structurizr Workspace</strong><br /><span>C4 model source for architecture ownership.</span></a></li>
            <li><a href="./server/" target="_blank" rel="noreferrer"><strong>Server Source Folder</strong><br /><span>Symlink root for dependency node click targets.</span></a></li>
            <li><a href="./tools/" target="_blank" rel="noreferrer"><strong>Tools Source Folder</strong><br /><span>Symlink root for tooling dependency nodes.</span></a></li>
          </ul>
        </article>
      </section>

      <section class="panel section section-spaced">
        <div class="section-header">
          <h2>Dependency Graph Viewer</h2>
          <div class="controls">
            <input id="module-search" class="control mono" type="search" placeholder="search module name..." />
            <a class="btn btn-subtle" href="./dependency-graph.svg" target="_blank" rel="noreferrer">Open Fullscreen</a>
          </div>
        </div>
        <div class="dependency-canvas">
          <object data="./dependency-graph.svg" type="image/svg+xml" aria-label="dependency graph"></object>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Depends On</th>
                <th>Used By</th>
                <th>Flags</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody id="module-table-body"></tbody>
          </table>
        </div>
        <div id="module-detail" class="detail">
          <h3>Select a module from the table to inspect local in/out edges.</h3>
        </div>
      </section>

      <section class="panel section section-spaced">
        <div class="section-header">
          <h2>OpenAPI Reference Embed</h2>
          <a class="btn btn-subtle" href="./sis-admin.openapi.html" target="_blank" rel="noreferrer">Open in New Tab</a>
        </div>
        <iframe src="./sis-admin.openapi.html" title="SIS Admin OpenAPI"></iframe>
      </section>
    </main>

    <script>
      const WORKFLOWS = ${JSON.stringify(workflows)};
      const state = {
        modules: [],
        query: "",
        selectedWorkflowId: WORKFLOWS.length ? WORKFLOWS[0].id : "",
      };

      const elements = {
        workflowSelect: document.getElementById("workflow-select"),
        workflowList: document.getElementById("workflow-list"),
        workflowSummary: document.getElementById("workflow-summary"),
        workflowDiagram: document.getElementById("workflow-diagram"),
        workflowSourceLink: document.getElementById("workflow-source-link"),
        workflowStatus: document.getElementById("workflow-status"),
        moduleSearch: document.getElementById("module-search"),
        moduleTableBody: document.getElementById("module-table-body"),
        moduleDetail: document.getElementById("module-detail"),
        statModules: document.getElementById("stat-modules"),
        statEdges: document.getElementById("stat-edges"),
        statOrphans: document.getElementById("stat-orphans"),
        statTopUsed: document.getElementById("stat-top-used"),
      };

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function encodePath(pathValue) {
        return pathValue
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/");
      }

      function toSourceHref(pathValue) {
        return "./" + encodePath(pathValue);
      }

      function setWorkflowStatus(message, warn = false) {
        elements.workflowStatus.textContent = message;
        elements.workflowStatus.classList.toggle("warn", warn);
      }

      async function fetchText(url) {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) throw new Error("Could not fetch " + url + " (" + response.status + ")");
        return response.text();
      }

      let mermaidPromise;
      async function getMermaid() {
        if (!mermaidPromise) {
          mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
            .then((mod) => {
              const api = mod.default || mod;
              api.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict", flowchart: { htmlLabels: true } });
              return api;
            })
            .catch(() => null);
        }
        return mermaidPromise;
      }

      function renderWorkflowList() {
        elements.workflowList.innerHTML = "";
        elements.workflowSelect.innerHTML = "";

        WORKFLOWS.forEach((workflow) => {
          const option = document.createElement("option");
          option.value = workflow.id;
          option.textContent = workflow.label;
          elements.workflowSelect.appendChild(option);

          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.workflowId = workflow.id;
          button.innerHTML = "<strong>" + escapeHtml(workflow.label) + "</strong><br /><span>" + escapeHtml(workflow.summary) + "</span>";
          button.addEventListener("click", () => {
            state.selectedWorkflowId = workflow.id;
            elements.workflowSelect.value = workflow.id;
            updateWorkflowSelectionState();
            renderSelectedWorkflow();
          });
          item.appendChild(button);
          elements.workflowList.appendChild(item);
        });

        elements.workflowSelect.value = state.selectedWorkflowId;
      }

      function updateWorkflowSelectionState() {
        const buttons = elements.workflowList.querySelectorAll("button");
        buttons.forEach((button) => {
          button.classList.toggle("active", button.dataset.workflowId === state.selectedWorkflowId);
        });
      }

      async function renderSelectedWorkflow() {
        const workflow = WORKFLOWS.find((item) => item.id === state.selectedWorkflowId);
        if (!workflow) return;

        elements.workflowSummary.textContent = workflow.summary;
        elements.workflowSourceLink.textContent = workflow.path;
        elements.workflowSourceLink.href = workflow.path;
        setWorkflowStatus("Loading workflow source...");

        try {
          const source = await fetchText(workflow.path);
          const mermaid = await getMermaid();

          if (mermaid) {
            const renderId = "workflow-" + workflow.id + "-" + Date.now();
            const rendered = await mermaid.render(renderId, source);
            elements.workflowDiagram.classList.remove("raw");
            elements.workflowDiagram.innerHTML = rendered.svg;
            setWorkflowStatus("Rendered with Mermaid.");
          } else {
            elements.workflowDiagram.classList.add("raw");
            elements.workflowDiagram.textContent = source;
            setWorkflowStatus("Mermaid runtime unavailable, showing raw source.", true);
          }
        } catch (error) {
          elements.workflowDiagram.classList.add("raw");
          elements.workflowDiagram.textContent = "Unable to load diagram: " + error.message;
          setWorkflowStatus("Failed to load workflow diagram.", true);
        }
      }

      function getResolvedDependencies(moduleRecord) {
        return (moduleRecord.dependencies || [])
          .map((dependency) => dependency && (dependency.resolved || dependency.module))
          .filter(Boolean);
      }

      function updateStats() {
        const modules = state.modules;
        const moduleCount = modules.length;
        const dependencyCount = modules.reduce((sum, moduleRecord) => sum + getResolvedDependencies(moduleRecord).length, 0);
        const orphanCount = modules.filter((moduleRecord) => moduleRecord.orphan).length;
        const sortedByFanIn = modules
          .slice()
          .sort((left, right) => (right.dependents || []).length - (left.dependents || []).length);
        const topUsed = sortedByFanIn[0];

        elements.statModules.textContent = String(moduleCount);
        elements.statEdges.textContent = String(dependencyCount);
        elements.statOrphans.textContent = String(orphanCount);
        elements.statTopUsed.textContent = topUsed
          ? topUsed.source + " (" + (topUsed.dependents || []).length + ")"
          : "n/a";
      }

      function moduleMatchesQuery(moduleRecord) {
        if (!state.query) return true;
        const query = state.query;
        const textParts = [moduleRecord.source]
          .concat(getResolvedDependencies(moduleRecord))
          .concat(moduleRecord.dependents || []);
        return textParts.some((part) => String(part).toLowerCase().includes(query));
      }

      function renderModuleDetail(moduleRecord) {
        const dependencies = getResolvedDependencies(moduleRecord);
        const dependents = moduleRecord.dependents || [];

        function renderLinkList(items) {
          if (!items.length) return "<li><em>none</em></li>";
          return items
            .map((item) => {
              const label = escapeHtml(item);
              const href = toSourceHref(item);
              return '<li><a class="mono" href="' + href + '" target="_blank" rel="noreferrer">' + label + "</a></li>";
            })
            .join("");
        }

        const flags = [];
        if (moduleRecord.orphan) flags.push('<span class="badge warn">orphan</span>');
        if (!moduleRecord.valid) flags.push('<span class="badge warn">invalid</span>');
        if (!flags.length) flags.push('<span class="badge">healthy</span>');

        elements.moduleDetail.innerHTML =
          "<h3>" +
          '<a class="mono" href="' +
          toSourceHref(moduleRecord.source) +
          '" target="_blank" rel="noreferrer">' +
          escapeHtml(moduleRecord.source) +
          "</a>" +
          "</h3>" +
          '<p>' +
          flags.join(" ") +
          "</p>" +
          '<div class="detail-grid">' +
          '<div><strong>Depends on (' +
          dependencies.length +
          ')</strong><ul class="detail-list">' +
          renderLinkList(dependencies) +
          "</ul></div>" +
          '<div><strong>Used by (' +
          dependents.length +
          ')</strong><ul class="detail-list">' +
          renderLinkList(dependents) +
          "</ul></div>" +
          "</div>";
      }

      function renderModuleTable() {
        const visible = state.modules.filter(moduleMatchesQuery).sort((left, right) => left.source.localeCompare(right.source));
        elements.moduleTableBody.innerHTML = "";

        if (!visible.length) {
          const row = document.createElement("tr");
          row.innerHTML = '<td colspan="5" class="mono">No modules matched your search query.</td>';
          elements.moduleTableBody.appendChild(row);
          return;
        }

        visible.forEach((moduleRecord) => {
          const dependencyCount = getResolvedDependencies(moduleRecord).length;
          const dependentCount = (moduleRecord.dependents || []).length;

          const row = document.createElement("tr");
          row.innerHTML =
            '<td class="mono"><a href="' +
            toSourceHref(moduleRecord.source) +
            '" target="_blank" rel="noreferrer">' +
            escapeHtml(moduleRecord.source) +
            "</a></td>" +
            "<td>" +
            dependencyCount +
            "</td>" +
            "<td>" +
            dependentCount +
            "</td>" +
            '<td>' +
            (moduleRecord.orphan ? '<span class="badge warn">orphan</span> ' : "") +
            (moduleRecord.valid ? '<span class="badge">valid</span>' : '<span class="badge warn">invalid</span>') +
            "</td>" +
            '<td><button type="button" class="control">Inspect</button></td>';

          const button = row.querySelector("button");
          button.addEventListener("click", () => renderModuleDetail(moduleRecord));
          elements.moduleTableBody.appendChild(row);
        });
      }

      async function loadDependencyData() {
        try {
          const raw = await fetchText("./dependency-graph.json");
          const parsed = JSON.parse(raw);
          state.modules = Array.isArray(parsed.modules) ? parsed.modules : [];
          updateStats();
          renderModuleTable();
          if (state.modules.length) renderModuleDetail(state.modules[0]);
        } catch (error) {
          elements.moduleTableBody.innerHTML = '<tr><td colspan="5" class="mono">Could not load dependency graph JSON: ' + escapeHtml(error.message) + "</td></tr>";
          elements.moduleDetail.innerHTML = "<h3>Dependency data unavailable</h3>";
        }
      }

      function bindEvents() {
        elements.workflowSelect.addEventListener("change", (event) => {
          state.selectedWorkflowId = event.target.value;
          updateWorkflowSelectionState();
          renderSelectedWorkflow();
        });

        elements.moduleSearch.addEventListener("input", (event) => {
          state.query = String(event.target.value || "").toLowerCase().trim();
          renderModuleTable();
        });
      }

      async function init() {
        renderWorkflowList();
        updateWorkflowSelectionState();
        bindEvents();
        await Promise.all([renderSelectedWorkflow(), loadDependencyData()]);
      }

      init();
    </script>
  </body>
</html>
`
}

function ensureOutLink(name) {
  const linkPath = path.join(outDir, name)
  const targetPath = path.join(repoRoot, name)
  const relativeTarget = path.relative(outDir, targetPath)

  try {
    if (existsSync(linkPath)) {
      const existing = lstatSync(linkPath)
      const shouldReplace = !existing.isSymbolicLink()
      if (shouldReplace) rmSync(linkPath, { recursive: true, force: true })
    }
    if (!existsSync(linkPath)) symlinkSync(relativeTarget, linkPath, "dir")
    console.log(`[map] linked ${path.relative(repoRoot, linkPath)} -> ${relativeTarget}`)
  } catch (error) {
    console.warn(`[map] could not create link for ${name}: ${error.message}`)
  }
}

function writeMappingPortalArtifacts() {
  ensureOutLink("server")
  ensureOutLink("tools")
  const portalHtml = buildMappingPortalHtml({ generatedAtIso: new Date().toISOString() })
  writeArtifact("index.html", portalHtml)
  writeArtifact("mapping-portal.html", portalHtml)
}

if (!openapiOnly) {
  console.log("[map] generating dependency graph artifacts...")
  const depCruiseArgs = ["depcruise", "--config", ".dependency-cruiser.cjs", "server", "tools"]
  const mermaid = runOrThrow("npx", [...depCruiseArgs, "--output-type", "mermaid"], true)
  const json = runOrThrow("npx", [...depCruiseArgs, "--output-type", "json"], true)
  const dotSource = runOrThrow("npx", [...depCruiseArgs, "--output-type", "dot"], true)
  const svg = rewriteDependencySvgLinks(runWithInputOrThrow("dot", ["-Tsvg"], dotSource))
  writeArtifact("dependency-graph.mmd", mermaid)
  writeArtifact("dependency-graph.json", json)
  writeArtifact("dependency-graph.svg", svg)
}

if (!depsOnly) {
  console.log("[map] linting OpenAPI spec...")
  runOrThrow(
    "npx",
    ["redocly", "lint", "--config", "redocly.yaml", "docs/mapping/openapi/sis-admin.openapi.yaml"],
    false
  )
  console.log("[map] building OpenAPI HTML docs...")
  runOrThrow(
    "npx",
    [
      "redocly",
      "build-docs",
      "--config",
      "redocly.yaml",
      "docs/mapping/openapi/sis-admin.openapi.yaml",
      "--output",
      "docs/mapping/out/sis-admin.openapi.html",
    ],
    false
  )
}

console.log("[map] generating mapping portal...")
writeMappingPortalArtifacts()

console.log("[map] mapping stack build complete.")
