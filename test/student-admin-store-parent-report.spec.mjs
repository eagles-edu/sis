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
      pt_skill_questions: "5",
      pt_skill_logic: "5",
    },
    conductScores: {
      pt_conduct_focus: "4",
      pt_conduct_maturity: "5",
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
      pt_skill_questions: "5",
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
      pt_skill_internationalNews: "5",
      pt_skill_readingEnglishEnjoyment: "5",
      pt_skill_vocabularyLookup: "5",
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
      pt_skill_logic: "5",
    },
    conductScores: {
      pt_conduct_focus: "2",
    },
    recommendations: {
      pt_rec_listening: "Use timer at home.",
    },
  })
  assert.equal(decoded.metaPayload, null)
})

test("encode/decode parent report bundle round-trips class-focus and homework snapshot metadata", () => {
  const encoded = encodeParentReportCommentBundle(
    "Metadata comment",
    {
      skillScores: {
        pt_skill_questions: "4",
      },
    },
    {
      classDate: "2026-09-15",
      classDay: "Tuesday",
      teacherName: "Ms. Nguyen",
      lessonSummary: "Reviewed Unit 3 reading and vocabulary strategy.",
      visionStatus: "needs-check",
      homeworkAnnouncement: "Homework Past Due | due 2026-09-14",
      currentHomeworkStatus: "Cần theo dõi",
      currentHomeworkHeader: "Homework Past Due",
      currentHomeworkSummary: "Homework Past Due | due 2026-09-14",
      pastDueHomeworkCount: "2",
      pastDueHomeworkSummary: "2 bài tập quá hạn cần xử lý ngay.",
      recipients: ["student@example.com", "parent@example.com"],
      outstandingAssignments: [
        {
          assignmentName: "Homework Past Due",
          dueAt: "2026-09-14",
          className: "A2 Flyers",
          quarter: "q1",
          deepLink: "https://eagles.edu.vn/homework/hw-1",
        },
      ],
    }
  )

  assert.match(encoded || "", /\[\[SIS-REPORT-BUNDLE-V2:/)

  const decoded = decodeParentReportCommentBundle(encoded)
  assert.equal(decoded.comment, "Metadata comment")
  assert.deepEqual(decoded.rubricPayload, {
    skillScores: {
      pt_skill_questions: "4",
    },
    conductScores: {},
    recommendations: {},
  })
  assert.deepEqual(decoded.metaPayload, {
    classDate: "2026-09-15",
    classDay: "Tuesday",
    teacherName: "Ms. Nguyen",
    lessonSummary: "Reviewed Unit 3 reading and vocabulary strategy.",
    visionStatus: "needs-check",
    homeworkAnnouncement: "Homework Past Due | due 2026-09-14",
    currentHomeworkStatus: "Cần theo dõi",
    currentHomeworkHeader: "Homework Past Due",
    currentHomeworkSummary: "Homework Past Due | due 2026-09-14",
    pastDueHomeworkCount: "2",
    pastDueHomeworkSummary: "2 bài tập quá hạn cần xử lý ngay.",
    recipients: ["student@example.com", "parent@example.com"],
    outstandingAssignments: [
      {
        assignmentName: "Homework Past Due",
        dueAt: "2026-09-14",
        className: "A2 Flyers",
        quarter: "q1",
        deepLink: "https://eagles.edu.vn/homework/hw-1",
      },
    ],
  })
})

test("decodeParentReportCommentBundle handles plain comments and invalid markers", () => {
  const plain = decodeParentReportCommentBundle("Only plain comment")
  assert.equal(plain.comment, "Only plain comment")
  assert.equal(plain.rubricPayload, null)
  assert.equal(plain.metaPayload, null)

  const invalidMarker = decodeParentReportCommentBundle("Only plain comment\n[[SIS-RUBRIC-V1:not-valid-json]]")
  assert.equal(invalidMarker.comment, "Only plain comment")
  assert.equal(invalidMarker.rubricPayload, null)
  assert.equal(invalidMarker.metaPayload, null)
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

test("student news save keeps open-date restriction for new rows and allows historical non-approved resubmits", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  assert.match(source, /if \(!existing\) \{\s*assertWithStatus\(reportDateText === window\.reportDate, 403, "News report for this date is locked"\)\s*\}/s)
  assert.match(source, /if \(existing && normalizeStudentNewsReviewStatus\(existing\.reviewStatus\) === STUDENT_NEWS_REVIEW_STATUS_APPROVED\) \{\s*assertWithStatus\(false, 403, "Approved news reports cannot be edited"\)\s*\}/s)
  assert.match(source, /const isResubmission = Boolean\(existing\)/)
  assert.match(source, /const reviewStatus = hasFailures && !isResubmission/)
  assert.match(source, /Status remains waiting for admin review\./)
  assert.match(source, /hasPrismaDelegateMethod\(prisma, "studentNewsReport", "findFirst"\)/)
  assert.match(source, /reportDate:\s*\{\s*gte:\s*reportDateRangeStart,\s*lt:\s*reportDateRangeEnd,\s*\}/s)
  assert.match(source, /const fallbackExisting = listStudentNewsReportsFromFallbackStore\(id, \{\s*startDate: reportDateText,\s*endDate: reportDateText,\s*\}\)/s)
  assert.match(source, /const existingId = normalizeText\(existing\?\.id\)/)
  assert.match(source, /prisma\.studentNewsReport\.update\(\{\s*where:\s*\{\s*id:\s*existingId\s*\},\s*data:\s*reportData,\s*\}\)/s)
})

test("student news save refreshes submittedAt on each allowed submission", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  assert.match(source, /const submittedAt = new Date\(\)/)
  assert.match(source, /const reportData = \{[\s\S]*submittedAt,[\s\S]*reviewStatus,/)
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

test("parent routes keep legacy parent-report metadata backfill guards", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  assert.match(source, /function backfillLegacyParentReportMetadataRows\(/)
  assert.match(source, /function buildLegacyReportMetaPayload\(/)
  assert.match(source, /encodeParentReportCommentBundle\(/)
  assert.match(source, /await backfillLegacyParentReportMetadataRows\(\{\s*prisma,\s*reportRows,\s*gradeRows/s)
  assert.match(source, /async function getStudentByIdWithReportBackfill\(/)
})
