import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  decodeParentReportCommentBundle,
  encodeParentReportCommentBundle,
  normalizeParentReportRubricPayload,
} from "../server/student-admin-store.mjs"

test("normalizeParentReportRubricPayload keeps only valid rubric keys and scores", () => {
  const normalized = normalizeParentReportRubricPayload({
    skillScores: {
      pt_skill_questions: "7",
      pt_skill_logic: 9.2,
      invalidSkill: 5,
      pt_skill_bad: "",
    },
    conductScores: {
      pt_conduct_focus: "4",
      pt_conduct_maturity: 6,
      bad_conduct: 8,
    },
    recommendations: {
      pt_rec_focus: "Review focus routine.",
      pt_rec_maturity: "",
      bad_rec: "skip",
    },
  })

  assert.deepEqual(normalized, {
    skillScores: {
      pt_skill_questions: "7",
      pt_skill_logic: "9",
    },
    conductScores: {
      pt_conduct_focus: "4",
      pt_conduct_maturity: "6",
    },
    recommendations: {
      pt_rec_focus: "Review focus routine.",
    },
  })
})

test("normalizeParentReportRubricPayload drops restricted digital-reading rubric fields below Flyers", () => {
  const normalized = normalizeParentReportRubricPayload(
    {
      skillScores: {
        pt_skill_internationalNews: "8",
        pt_skill_readingEnglishEnjoyment: "7",
        pt_skill_vocabularyLookup: "9",
        pt_skill_questions: "6",
      },
      recommendations: {
        pt_rec_internationalNews: "Blocked below Flyers.",
        pt_rec_vocabularyLookup: "Blocked below Flyers.",
        pt_rec_questions: "Keep asking questions.",
      },
    },
    { level: "A1 Movers" }
  )

  assert.deepEqual(normalized, {
    skillScores: {
      pt_skill_questions: "6",
    },
    conductScores: {},
    recommendations: {
      pt_rec_questions: "Keep asking questions.",
    },
  })
})

test("normalizeParentReportRubricPayload keeps digital-reading rubric fields for Flyers and above", () => {
  const normalized = normalizeParentReportRubricPayload(
    {
      skillScores: {
        pt_skill_internationalNews: "8",
        pt_skill_readingEnglishEnjoyment: "7",
        pt_skill_vocabularyLookup: "9",
      },
      recommendations: {
        pt_rec_internationalNews: "Read and summarize.",
        pt_rec_vocabularyLookup: "Use dictionary audio.",
      },
    },
    { className: "A2 Flyers" }
  )

  assert.deepEqual(normalized, {
    skillScores: {
      pt_skill_internationalNews: "8",
      pt_skill_readingEnglishEnjoyment: "7",
      pt_skill_vocabularyLookup: "9",
    },
    conductScores: {},
    recommendations: {
      pt_rec_internationalNews: "Read and summarize.",
      pt_rec_vocabularyLookup: "Use dictionary audio.",
    },
  })
})

test("encode/decode parent report bundle round-trips comments and rubric payload", () => {
  const encoded = encodeParentReportCommentBundle("Parent note", {
    skillScores: {
      pt_skill_questions: "0",
      pt_skill_logic: "10",
    },
    conductScores: {
      pt_conduct_focus: "2",
    },
    recommendations: {
      pt_rec_listening: "Use timer at home.",
    },
  })

  assert.match(encoded || "", /\[\[SIS-RUBRIC-V1:/)

  const decoded = decodeParentReportCommentBundle(encoded)
  assert.equal(decoded.comment, "Parent note")
  assert.deepEqual(decoded.rubricPayload, {
    skillScores: {
      pt_skill_questions: "0",
      pt_skill_logic: "10",
    },
    conductScores: {
      pt_conduct_focus: "2",
    },
    recommendations: {
      pt_rec_listening: "Use timer at home.",
    },
  })
})

test("decodeParentReportCommentBundle handles plain comments and invalid markers", () => {
  const plain = decodeParentReportCommentBundle("Only plain comment")
  assert.equal(plain.comment, "Only plain comment")
  assert.equal(plain.rubricPayload, null)

  const invalidMarker = decodeParentReportCommentBundle("Only plain comment\n[[SIS-RUBRIC-V1:not-valid-json]]")
  assert.equal(invalidMarker.comment, "Only plain comment")
  assert.equal(invalidMarker.rubricPayload, null)
})

test("parent report save path keeps legacy participation-points schema fallback guards", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  assert.match(source, /isLegacyParentReportParticipationPointsSchemaError\(/)
  assert.match(source, /isUnknownPrismaArgumentError\(error, "participationPointsAward"\)/)
  assert.match(source, /isUnknownPrismaFieldError\(error, "participationPointsAward"\)/)
  assert.match(source, /stripLegacyParentReportFields\(reportData\)/)
})

test("student news save/list paths keep model-drift fallback guards", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  assert.match(source, /isStudentNewsReportSchemaUnavailableError\(/)
  assert.match(source, /listStudentNewsReportsFromFallbackStore\(/)
  assert.match(source, /upsertStudentNewsReportInFallbackStore\(/)
})

test("student news review queue keeps DB-native review persistence guards", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  assert.match(source, /buildStudentNewsReviewSelect\(/)
  assert.match(source, /isStudentNewsReviewSchemaUnavailableError\(/)
  assert.match(source, /prisma\.studentNewsReport\.update\(/)
  assert.match(source, /reviewStatus,\s*reviewNote,\s*reviewedByUsername,\s*reviewedAt/)
  assert.doesNotMatch(source, /STUDENT_NEWS_REVIEW_STATE_FILE_PATH/)
  assert.doesNotMatch(source, /upsertStudentNewsReviewState\(/)
  assert.match(source, /export async function listStudentNewsReportsForReview\(/)
  assert.match(source, /export async function reviewStudentNewsReport\(/)
})
