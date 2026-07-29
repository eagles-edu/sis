#!/usr/bin/env node
// @ts-check

const endpoint = process.env.STUDENT_NEWS_GRAMMAR_ENDPOINT || "http://127.0.0.1:8093/v2/check"
const cases = [
  { text: "Mark are playing football.", rules: ["SIS_PROPER_NAME_ARE"] },
  { text: "Brian were late.", rules: ["SIS_PROPER_NAME_WERE"] },
  { text: "The boy play football.", rules: ["SIS_SINGULAR_NOUN_COMMON_BASE_VERB"] },
  { text: "My sister have a book.", rules: ["SIS_SINGULAR_NOUN_COMMON_BASE_VERB"] },
  { text: "The student are happy.", rules: ["SIS_SINGULAR_NOUN_ARE"] },
  { text: "The student were happy.", rules: ["SIS_SINGULAR_NOUN_WERE"] },
  { text: "The student happy.", rules: ["SIS_SINGULAR_NOUN_MISSING_COPULA"] },
  { text: "Because the students were late.", rules: ["SIS_STANDALONE_SUBORDINATE_CLAUSE"] },
  { text: "Although it rained.", rules: ["SIS_STANDALONE_SUBORDINATE_CLAUSE"] },
  { text: "Because the students were late, the teacher repeated the instructions.", rules: [] },
  { text: "When the lesson ended.", rules: ["SIS_STANDALONE_WHEN_CLAUSE"] },
  { text: "When the lesson ended, the students went home.", rules: [] },
  { text: "I like coffee, Mary likes tea.", rules: ["SIS_COMMA_SPLICE_PRONOUN_CLAUSES"] },
  { text: "I like coffee, but Mary likes tea.", rules: [] },
  { text: "I like coffee; Mary likes tea.", rules: [] },
  { text: "Mark and Brian are ready.", rules: [], excludedRules: ["SIS_PROPER_NAME_ARE"] },
  { text: "She is student.", rules: ["ARTICLE_MISSING"] },
  { text: "They travel by car.", rules: [], excludedRules: ["ARTICLE_MISSING"] },
  { text: "I have a books.", rules: ["A_NNS"] },
  { text: "I have many book.", rules: ["MANY_NN"] },
  { text: "I have much books.", rules: ["MUCH_COUNTABLE"] },
  { text: "This books is new.", rules: ["AGREEMENT_SENT_START"] },
  { text: "These book are new.", rules: ["THIS_NNS"] },
  { text: "Him went to school.", rules: ["SIS_OBJECT_PRONOUN_AS_SUBJECT"] },
  { text: "I saw he yesterday.", rules: ["SIS_SUBJECT_PRONOUN_AS_OBJECT"] },
  { text: "This is mine book.", rules: ["SIS_POSSESSIVE_PRONOUN_BEFORE_NOUN"] },
  { text: "He hurt herself.", rules: ["SIS_REFLEXIVE_PRONOUN_AGREEMENT"] },
  { text: "He hurt himself.", rules: [], excludedRules: ["SIS_REFLEXIVE_PRONOUN_AGREEMENT"] },
  { text: "The croud was wildt.", rules: ["MORFOLOGIK_RULE_EN_US"] },
  { text: "He still doing homework.", rules: ["PRP_VBG"] },
  { text: "She walk to school every day.", rules: ["HE_VERB_AGR"] },
  { text: "They walks to school every day.", rules: ["NON3PRS_VERB"] },
  { text: "The students has completed the exercise.", rules: ["AGREEMENT_SENT_START"] },
  { text: "The teacher is explain the lesson.", rules: ["BEEN_PART_AGREEMENT"] },
  { text: "The teacher is explaining the lesson.", rules: [] },
  { text: "Yesterday she go home.", rules: ["HE_VERB_AGR"], excludedRules: ["SIS_SINGULAR_NOUN_MISSING_COPULA"] },
  { text: "When did he arrive?", rules: [], excludedRules: ["SIS_STANDALONE_SUBORDINATE_CLAUSE"] },
]

let failed = false
for (const entry of cases) {
  const body = new URLSearchParams({ language: "en-US", text: entry.text, enabledRules: "ARTICLE_MISSING" })
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!response.ok) throw new Error(`LanguageTool returned HTTP ${response.status}`)
  /** @type {{ matches?: Array<{ rule?: { id?: string } }> }} */
  const payload = await response.json()
  const ids = new Set(Array.isArray(payload.matches) ? payload.matches.map((match) => match.rule?.id) : [])
  const missing = entry.rules.filter((ruleId) => !ids.has(ruleId))
  const unexpected = (entry.excludedRules || []).filter((ruleId) => ids.has(ruleId))
  if (missing.length || unexpected.length) {
    failed = true
    console.error(`FAIL ${JSON.stringify(entry.text)}: missing ${missing.join(", ") || "none"}; unexpected ${unexpected.join(", ") || "none"}; got ${Array.from(ids).join(", ") || "no matches"}`)
  } else {
    console.log(`PASS ${JSON.stringify(entry.text)}: ${entry.rules.join(", ")}`)
  }
}

if (failed) process.exitCode = 1
