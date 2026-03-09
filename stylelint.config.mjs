export default {
  customSyntax: "postcss-html",
  ignoreFiles: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/output/**",
    "**/backups/**",
    "**/docs/logs/**",
    "**/docs/mapping/out/**",
  ],
  rules: {
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-block-no-duplicate-properties": [
      true,
      { ignore: ["consecutive-duplicates-with-different-values"] },
    ],
    "font-family-no-duplicate-names": true,
    "function-calc-no-unspaced-operator": true,
    "no-empty-source": true,
    "no-invalid-double-slash-comments": true,
    "property-no-unknown": [true, { ignoreProperties: ["/^--/"] }],
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global"] }],
    "selector-pseudo-element-no-unknown": true,
    "string-no-newline": true,
    "unit-no-unknown": true,
  },
}
