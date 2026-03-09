import js from "@eslint/js"
import globals from "globals"

const ignores = [
  "**/*.md",
  ".git/",
  ".github/",
  ".codex/",
  ".continue/",
  "tmp/",
  "node_modules/",
  "dist/",
  "build/",
  "output/",
  "backups/",
  "docs/logs/",
  "docs/mapping/out/",
]

export default [
  { ignores },
  js.configs.recommended,
  {
    files: ["server/**/*.mjs", "test/**/*.mjs", "tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // Stage-in policy: keep parser/safety rules strict while suppressing legacy noise.
      "no-unused-vars": "off",
      "no-useless-escape": "off",
    },
  },
]
