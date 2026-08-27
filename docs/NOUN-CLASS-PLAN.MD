# Library Noun Classification Schema

> Status: CURRENT. This is the authoritative noun-class schema for every Library editor: New Words, News/Week Set vocabulary, student Library proposals, admin review, and canonical Library editing.

> Dictionary Builder boundary: the Builder may present this structured POS data as a fully expanded editable candidate, but it must preserve this schema's fixed field order and validation. [`PERFECT_DIC_PLAN_V1.5.md`](PERFECT_DIC_PLAN_V1.5.md) controls Builder modal behavior and source fallback, not noun-class meaning.

## Purpose

Noun classification is a constrained, persisted grammar profile. The editor order is fixed: `Countability -> Quality -> Number -> Classification`.

## Persisted payload

| Field | Values | Rule |
| --- | --- | --- |
| `countability` | `countable`, `uncountable`, `countable_and_uncountable` | Required. |
| `physicalQuality` | `concrete`, `material`, `abstract` | Required. |
| `grammaticalNumber` | `singular`, `plural`, `singular_and_plural` | Required. |
| `primaryClassification` | `common`, `proper`, `collective`, `compound`, `possessive` | Required. |
| `materialUsage` | `mass`, `variety` | Required only for material nouns. |
| `properNounVariantShift` | boolean | Permits plural proper nouns. |
| `dualCountabilityUsage` | `same_sense`, `different_senses` | Required for dual-countability nouns. |

Legacy `nounType` and `nounNumber` remain audit fields. New editors save the fields above and emit legacy values only when the mapping is exact.

## State matrix

| Countability | Quality | Number | Classification | Required state |
| --- | --- | --- | --- | --- |
| countable | concrete | singular or plural | common, proper, collective, compound, possessive | Standard countable noun. |
| countable | abstract | singular or plural | common, compound, possessive | Proper and collective unavailable. |
| uncountable | concrete | singular | common, compound, possessive | Physical aggregate/mass noun. |
| uncountable | abstract | singular | common, compound, possessive | Abstract non-count noun. |
| uncountable | material | singular | common | `materialUsage=mass`; dependent controls lock. |
| countable | material | plural | common | `materialUsage=variety`; types or grades. |
| countable_and_uncountable | concrete or abstract | singular_and_plural | common, compound, possessive | `dualCountabilityUsage` required. |
| countable_and_uncountable | material | singular_and_plural | common | Document dual use and `materialUsage=variety`. |

Collective nouns force concrete. Proper nouns default to concrete singular. `properNounVariantShift=true` is the only way to select a plural proper noun.

## Editor transition rules

1. Material defaults to uncountable, singular, common, `materialUsage=mass`.
2. `materialUsage=variety` changes material to countable, plural, common.
3. Uncountable removes plural choices and sets singular.
4. Dual countability sets singular-and-plural and requires its usage explanation; it never silently collapses to one value.
5. Collective forces concrete. Abstract clears incompatible collective/proper classification.
6. Proper forces concrete singular. Its variant toggle unlocks plural; disabling it resets plural to singular.
7. A change resets only fields made invalid by that change and shows the profile reason.

## Server validation and migration

Every canonical Library write and contribution validates this matrix. Invalid payloads are rejected without guessed replacement. Migration maps only exact legacy values; unrecognized historical values remain unchanged for audit.

## Test matrix

Test all matrix rows, material default and variety transitions, plural locks, dual countability, collective/proper restrictions, invalid payload rejection, legacy mapping, filters, and every shared editor.
