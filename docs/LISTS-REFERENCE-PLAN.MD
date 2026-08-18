# Library Reference Lists Schema

> Status: CURRENT. This is the authoritative schema for standalone admin reference catalogs. Catalogs do not autofill or otherwise connect to Library entries.

## Catalogs

`verbs`, `awl`, `conjunctions`, `ed_ing_adjectives`, `pronouns`, `figurative_language`, and `noun_types` are separately managed catalog keys. Records have a term, optional POS/subtype, structured catalog data, source label/URL, editorial status, actor/timestamps, and an immutable revision.

## Import/export

Admins can download XLSX, ODS, and CSV templates and exports. Imports preview validation, then upsert by catalog natural key. They add or update records and never delete a catalog. Teachers and students cannot read or mutate catalog endpoints.

## Seed sources

- Verbs use the existing 996 unique American-English V1-V5 records.
- AWL uses SIS's Wellington-derived source.
- Grammar catalogs use the controlled values in this document and `NOUN-CLASS-PLAN.MD`.
- `-ed/-ing` adjectives retain source URLs and editorial status from the supplied British Council, Grammar.cl, Trussel, and IDP references.
- Figurative language uses one catalog with required subtype: idiom, simile, metaphor, euphemism, or `double_entendre`.
