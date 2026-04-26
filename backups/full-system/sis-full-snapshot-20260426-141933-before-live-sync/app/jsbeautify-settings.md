# js-beautify Settings Reference

Source: HookyQR VSCodeBeautify `Settings.md`.

This document mirrors the formatter options used by the repo's `.jsbeautifyrc`.
The JSON config stays comment-free so VS Code does not flag it as invalid JSON.

## Shared

- `eol`
  - Possible values: `"\n"`, `"\r\n"`, `"\r"`
  - Default: `"\n"`
  - Current: `"\n"`
- `end_with_newline`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: `false`
- `indent_char`
  - Possible values: a single-character string, commonly `" "` or `"\t"`
  - Default: `" "`
  - Current: `" "`
- `indent_size`
  - Possible values: integer `>= 0`
  - Default: `4`
  - Current: `2`
- `indent_with_tabs`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: `false`
- `preserve_newlines`
  - Possible values: `true`, `false`
  - Default: `true`
  - Current: `true`
- `max_preserve_newlines`
  - Possible values: integer `>= 0`
  - Default: `10`
  - Current: `2`
- `wrap_line_length`
  - Possible values: integer `>= 0`; set `0` to disable wrapping
  - Default: `0`
  - Current: `0`

## HTML

- `extra_liners`
  - Possible values: array of tag names
  - Default: `["head", "body", "/html"]`
  - Current: default
- `indent_body_inner_html`
  - Possible values: `true`, `false`
  - Default: `true`
  - Current: default
- `indent_handlebars`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `indent_head_inner_html`
  - Possible values: `true`, `false`
  - Default: `true`
  - Current: default
- `indent_inner_html`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: `false`
- `indent_scripts`
  - Possible values: `keep`, `separate`, `normal`
  - Default: `normal`
  - Current: default
- `inline`
  - Possible values: array of inline tag names
  - Default: the built-in inline tag list from Beautify
  - Current: default
- `content_unformatted`
  - Possible values: array of tag names
  - Default: `["pre", "textarea"]`
  - Current: default
- `unformatted`
  - Possible values: array of tag names
  - Default: `[]`
  - Current: default
- `void_elements`
  - Possible values: array of HTML void tag names
  - Default: the built-in void element list from Beautify
  - Current: default
- `wrap_attributes`
  - Possible values: `auto`, `force`, `force-aligned`, `force-expand-multiline`, `align-multiple`, `preserve`, `preserve-aligned`
  - Default: `auto`
  - Current: `force-expand-multiline`
- `wrap_attributes_indent_size`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: `false`

## JavaScript

- `brace_style`
  - Possible values: `collapse`, `expand`, `end-expand`, `none`, `collapse,preserve-inline`, `expand,preserve-inline`, `end-expand,preserve-inline`, `none,preserve-inline`
  - Default: `collapse`
  - Current: default
- `break_chained_methods`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `comma_first`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `e4x`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `indent_level`
  - Possible values: integer `>= 0`
  - Default: `0`
  - Current: default
- `jslint_happy`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `keep_array_indentation`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `keep_function_indentation`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `operator_position`
  - Possible values: `before-newline`, `after-newline`, `preserve-newline`
  - Default: `before-newline`
  - Current: default
- `space_after_anon_function`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `space_after_named_function`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `space_before_conditional`
  - Possible values: `true`, `false`
  - Default: `true`
  - Current: default
- `space_in_empty_paren`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `space_in_paren`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `unescape_strings`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `unindent_chained_methods`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default

## CSS

- `newline_between_rules`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
- `selector_separator_newline`
  - Possible values: `true`, `false`
  - Default: `true`
  - Current: default
- `space_around_combinator`
  - Possible values: `true`, `false`
  - Default: `false`
  - Current: default
