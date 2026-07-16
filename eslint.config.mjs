/** @format */

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
  "web-asset/vendor/",
]

export default [
  { ignores },
  js.configs.recommended,
  {
    files: [
      "server/**/*.mjs",
      "src/**/*.mjs",
      "test/**/*.mjs",
      "tools/**/*.mjs",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // Stage-in policy: keep parser/safety rules strict while suppressing legacy noise.
      "no-unused-vars": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["web-asset/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // Stage-in policy for legacy browser-admin code.
      "no-unused-vars": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
      "no-extra-boolean-cast": "off",
      "preserve-caught-error": "off",
    },
  },
]
