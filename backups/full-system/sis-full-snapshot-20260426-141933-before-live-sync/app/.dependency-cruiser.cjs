/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-server-circular",
      severity: "warn",
      comment: "Circular server dependencies make runtime wiring difficult to reason about.",
      from: { path: "^server" },
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Orphan modules usually indicate dead code or undocumented wiring.",
      from: {
        orphan: true,
        pathNot: "^(test|docs|tools/build-mapping-stack\\.mjs)",
      },
      to: {},
    },
  ],
  options: {
    baseDir: ".",
    includeOnly: "^(server|tools)",
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
}
