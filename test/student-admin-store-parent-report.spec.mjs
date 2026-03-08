import assert from "node:assert/strict"
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
