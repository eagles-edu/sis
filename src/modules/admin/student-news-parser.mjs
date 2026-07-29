// Dependency-free structural parser for student-news sentence diagnostics.
// It is intentionally conservative: unknown is preferable to an invented
// grammatical classification.

const SUBORDINATORS = new Set([
  "although", "after", "before", "because", "if", "since", "unless", "when", "while", "whereas", "that",
])
const COORDINATORS = new Set(["and", "but", "or", "nor", "for", "so", "yet"])
const RELATIVE_MARKERS = new Set(["who", "whom", "whose", "which", "that"])
const SUBJECT_WORDS = new Set([
  "i", "you", "he", "she", "it", "we", "they", "this", "that", "these", "those",
])
const AUXILIARIES = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "do", "does", "did", "can", "could", "may", "might", "must", "shall", "should",
  "will", "would",
])
const COMMON_FINITE_VERBS = new Set([
  "act", "acts", "acted", "affect", "affects", "affected", "arrive", "arrived", "become", "became",
  "cause", "causes", "caused", "come", "comes", "came", "continue", "continued", "create", "created",
  "evacuate", "evacuated", "fall", "fell", "flood", "flooded", "give", "gave", "go", "goes", "went",
  "happen", "happened", "help", "helped", "hit", "include", "included", "make", "made", "need", "needed",
  "protect", "protected", "report", "reported", "reports", "rise", "rose", "rises", "rose", "say", "said",
  "says", "show", "showed", "shows", "start", "started", "take", "took", "tell", "told", "use", "used",
])
const COMMON_NOUNS = new Set([
  "officials", "residents", "families", "sources", "teams", "perspectives", "people", "students", "children",
])

function tokenise(text) {
  return Array.from(String(text ?? "").matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?|[.!?,;:]/gu)).map((match) => ({
    text: match[0],
    lower: match[0].toLocaleLowerCase("en-US"),
    start: match.index || 0,
    end: (match.index || 0) + match[0].length,
    isWord: /^[A-Za-z]/u.test(match[0]),
  }))
}

function isFiniteVerb(token, previous) {
  if (!token?.isWord) return false
  if (COMMON_NOUNS.has(token.lower)) return false
  if (AUXILIARIES.has(token.lower) || COMMON_FINITE_VERBS.has(token.lower)) return true
  if (/(?:ed|s)$/u.test(token.lower) && !/(?:ness|ment|tion|ion|ous|less|ship)$/u.test(token.lower)) return true
  if (previous && AUXILIARIES.has(previous.lower) && /^(?:\w+)$/u.test(token.lower)) return false
  return false
}

function isSubjectCandidate(token) {
  if (!token?.isWord || SUBORDINATORS.has(token.lower) || COORDINATORS.has(token.lower)) return false
  return SUBJECT_WORDS.has(token.lower)
    || ["a", "an", "the"].includes(token.lower)
    || /^[A-Z]/u.test(token.text)
    || /(?:s|people|men|women|officials|teams|residents)$/u.test(token.lower)
}

function makeClause(text, tokens, start, end, clauseType, clauseFunction) {
  const segment = tokens.filter((token) => token.start >= start && token.end <= end && token.isWord)
  const finiteVerb = segment.find((token, index) => isFiniteVerb(token, segment[index - 1]))
  const subject = finiteVerb ? segment.slice(0, segment.indexOf(finiteVerb)).find(isSubjectCandidate) : null
  const first = segment[0]
  return {
    start,
    end,
    text: text.slice(start, end),
    constituentKind: "clause",
    clauseType,
    clauseFunction,
    finiteVerb: finiteVerb?.text || "",
    subject: subject?.text || "",
    hasFiniteVerb: Boolean(finiteVerb),
    hasSubjectEvidence: Boolean(subject),
    independent: clauseType === "independent" && Boolean(finiteVerb && subject),
    confidence: finiteVerb && subject ? 0.86 : finiteVerb ? 0.62 : 0.35,
    marker: SUBORDINATORS.has(first?.lower) || RELATIVE_MARKERS.has(first?.lower) ? first.lower : "",
  }
}

function buildClauses(text, tokens) {
  const words = tokens.filter((token) => token.isWord)
  if (!words.length) return []
  const clauses = []
  let segmentStart = words[0].start
  let segmentMarker = ""
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const next = words[index + 1]
    const followingWords = words.slice(index + 1)
    const followingFirst = followingWords[0]
    const followingVerbIndex = followingWords.findIndex((token, offset) => isFiniteVerb(token, followingWords[offset - 1]))
    const coordinatorStartsClause = COORDINATORS.has(word.lower)
      && followingFirst
      && !["also", "just", "then", "only"].includes(followingFirst.lower)
      && followingVerbIndex > 0
    const boundary = coordinatorStartsClause || SUBORDINATORS.has(word.lower) || (next && /[.!?;]/u.test(text.slice(word.end, next.start)))
    if (boundary && index > 0) {
      const segmentEnd = word.start
      const type = segmentMarker ? "subordinate" : "independent"
      clauses.push(makeClause(text, tokens, segmentStart, segmentEnd, type, segmentMarker === "because" ? "reason-adjunct" : "main-clause"))
      if (SUBORDINATORS.has(word.lower)) {
        segmentMarker = word.lower
        segmentStart = word.start
      } else {
        segmentMarker = ""
        segmentStart = next?.start || word.end
      }
    } else if (!segmentMarker && SUBORDINATORS.has(word.lower)) {
      segmentMarker = word.lower
    }
  }
  const finalEnd = text.trimEnd().length
  if (finalEnd > segmentStart) {
    clauses.push(makeClause(text, tokens, segmentStart, finalEnd, segmentMarker ? "subordinate" : "independent", segmentMarker === "because" ? "reason-adjunct" : "main-clause"))
  }
  return clauses.filter((clause) => clause.text.trim())
}

function buildPhrases(text, tokens, clauses) {
  const phrases = []
  for (const clause of clauses) {
    const clauseTokens = tokens.filter((token) => token.isWord && token.start >= clause.start && token.end <= clause.end)
    const finiteIndex = clauseTokens.findIndex((token, index) => isFiniteVerb(token, clauseTokens[index - 1]))
    if (finiteIndex > 0) {
      const first = clauseTokens[0]
      const last = clauseTokens[finiteIndex - 1]
      phrases.push({
        start: first.start,
        end: last.end,
        text: text.slice(first.start, last.end),
        constituentKind: "phrase",
        phraseClass: "noun-phrase",
        phraseType: "headed",
        phraseFunction: "subject",
        headword: clause.subject,
        modifiers: clauseTokens.slice(0, finiteIndex).filter((token) => token.text !== clause.subject).map((token) => token.text),
        confidence: clause.hasSubjectEvidence ? 0.72 : 0.38,
      })
    }
    for (let index = 0; index < clauseTokens.length; index += 1) {
      if (clauseTokens[index].lower !== "in" && clauseTokens[index].lower !== "at" && clauseTokens[index].lower !== "near" && clauseTokens[index].lower !== "after") continue
      const first = clauseTokens[index]
      const last = clauseTokens[Math.min(clauseTokens.length - 1, index + 2)]
      phrases.push({
        start: first.start,
        end: last.end,
        text: text.slice(first.start, last.end),
        constituentKind: "phrase",
        phraseClass: "prepositional-phrase",
        phraseType: "headed",
        phraseFunction: "adjunct",
        headword: first.text,
        modifiers: [],
        confidence: 0.58,
      })
    }
  }
  return phrases
}

export function parseStudentNewsSentence(value = "") {
  const text = String(value ?? "")
  const tokens = tokenise(text)
  const words = tokens.filter((token) => token.isWord)
  const clauses = buildClauses(text, tokens)
  const phrases = buildPhrases(text, tokens, clauses)
  const independentClauses = clauses.filter((clause) => clause.independent)
  const firstWord = words[0]
  const hasTerminalPunctuation = /[.!?]$/u.test(text.trim())
  const hasCoordinator = words.some((word) => COORDINATORS.has(word.lower))
  const classification = !words.length
    ? "fragment"
    : independentClauses.length === 0
      ? "fragment"
      : clauses.length > 1 && clauses.some((clause) => clause.clauseType === "subordinate")
        ? (independentClauses.length > 1 ? "compound-complex" : "complex")
        : independentClauses.length > 1 || hasCoordinator ? "compound" : "simple"
  return {
    start: text.length - text.trimStart().length,
    end: text.trimEnd().length,
    text: text.trim(),
    sentenceIndex: 0,
    wordCount: words.length,
    tokenCount: tokens.length,
    startsWithUppercase: Boolean(firstWord && /^[A-Z]/u.test(firstWord.text)),
    hasTerminalPunctuation,
    hasFiniteVerb: clauses.some((clause) => clause.hasFiniteVerb),
    hasSubjectEvidence: clauses.some((clause) => clause.hasSubjectEvidence),
    clauseCount: clauses.length,
    classification,
    confidence: independentClauses.length ? 0.82 : clauses.some((clause) => clause.hasFiniteVerb) ? 0.58 : 0.32,
    clauses,
    phrases,
  }
}

export { tokenise as tokenizeStudentNewsText }
