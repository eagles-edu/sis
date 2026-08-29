# Library Reference Lists Schema

> Status: CURRENT. This is the authoritative schema for standalone admin reference catalogs. Catalogs do not autofill or otherwise connect to Library entries.

## Catalogs

`verbs`, `awl`, `conjunctions`, `prepositions`, `determiners`, `auxiliaries`, `morphemes`, `ed_ing_adjectives`, `pronouns`, `idioms`, `figurative_language`, and `noun_types` are separately managed catalog keys. Records have a term, optional POS/subtype, structured catalog data, source label/URL, source page or sheet/row provenance where supplied, editorial status, actor/timestamps, and an immutable revision.

## Import/export

Admins can download XLSX, ODS, and CSV templates and exports. Imports preview validation, then upsert by catalog natural key. They add or update records and never delete a catalog. Teachers and students cannot read or mutate catalog endpoints.

## Seed sources

- Verbs use the existing 996 unique American-English V1-V5 records.
- AWL uses SIS's Wellington-derived source.
- Grammar catalogs use the controlled values in this document and `NOUN-CLASS-PLAN.MD`.
- `-ed/-ing` adjectives retain source URLs and editorial status from the supplied British Council, Grammar.cl, Trussel, and IDP references.
- Figurative language uses one catalog with required subtype: idiom, simile, metaphor, euphemism, or `double_entendre`.

## List presentation and workbook layout

- Every reference list is rendered as a responsive, striped table with hover highlighting, compact wrapping, readable clamped text, and horizontal overflow on narrow screens.
- Controls include search, important-column dropdown filters, sortable columns, ascending/descending direction, and selectable rows per page with centered pagination.
- Source labels, URLs, and source-page fields remain stored as provenance but are not displayed as table columns or included in reference-list XLSX layouts.
- Each XLSX export uses the selected catalog's ordered schema as its header layout, readable column widths, and all matching records rather than only the current page.
- Each catalog has its own XLSX export. Each file contains that list's complete data and import-compatible headers.
- The dev export command is `env SIS_ENV_FILE=.env.dev DOTENV_CONFIG_PATH=.env.dev NODE_ENV=development npm run library:reference:export-xlsx`; it writes one file per catalog under `docs/esl/reference-lists/`.
- AWL family IDs are stable display IDs: the first four letters of the italicized qualifying member, two-digit sublist, and two-digit alphabetical family position. For example, all members of the qualifying `accumulate` family in sublist 4 at position 1 use `ACCU0401`.
