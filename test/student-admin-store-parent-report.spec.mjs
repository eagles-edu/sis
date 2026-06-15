import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  decodeLegacyParentReportCommentBundle,
  normalizeParentReportWorkflowState,
  normalizeParentReportRubricPayload,
} from "../src/modules/admin/parent-reports.mjs"

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

test("legacy parent report rubric markers decode into first-class payload shape", () => {
  const encodedPayload = Buffer.from(
    JSON.stringify({
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
    }),
    "utf8"
  ).toString("base64url")
  const decoded = decodeLegacyParentReportCommentBundle(`Parent note\n[[SIS-RUBRIC-V1:${encodedPayload}]]`)
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

test("legacy parent report bundle markers decode into first-class payload shape", () => {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      rubricPayload: {
        skillScores: {
          pt_skill_questions: "4",
        },
      },
      metaPayload: {
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
      },
    }),
    "utf8"
  ).toString("base64url")
  const decoded = decodeLegacyParentReportCommentBundle(
    `Metadata comment\n[[SIS-REPORT-BUNDLE-V2:${encodedPayload}]]`
  )
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

test("decodeLegacyParentReportCommentBundle handles plain comments and invalid markers", () => {
  const plain = decodeLegacyParentReportCommentBundle("Only plain comment")
  assert.equal(plain.comment, "Only plain comment")
  assert.equal(plain.rubricPayload, null)
  assert.equal(plain.metaPayload, null)

  const invalidMarker = decodeLegacyParentReportCommentBundle("Only plain comment\n[[SIS-RUBRIC-V1:not-valid-json]]")
  assert.equal(invalidMarker.comment, "Only plain comment")
  assert.equal(invalidMarker.rubricPayload, null)
  assert.equal(invalidMarker.metaPayload, null)
})

test("parent report save path keeps legacy participation-points schema fallback guards", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/parent-reports.mjs", import.meta.url), "utf8")
  assert.match(source, /isLegacyParentReportParticipationPointsSchemaError\(/)
  assert.match(source, /isUnknownPrismaArgumentError\(error, "participationPointsAward"\)/)
  assert.match(source, /isUnknownPrismaFieldError\(error, "participationPointsAward"\)/)
  assert.match(source, /stripLegacyParentReportFields\(reportData\)/)
})

test("normalizeParentReportWorkflowState recognizes the implemented report workflow", () => {
  assert.equal(normalizeParentReportWorkflowState("draft_pr"), "draft_pr")
  assert.equal(
    normalizeParentReportWorkflowState("submitted_for_admin_review"),
    "submitted_for_admin_review"
  )
  assert.equal(
    normalizeParentReportWorkflowState("incoming_admin_review"),
    "incoming_admin_review"
  )
  assert.equal(
    normalizeParentReportWorkflowState("awaiting_admin_approval"),
    "awaiting_admin_approval"
  )
  assert.equal(normalizeParentReportWorkflowState("published"), "published")
  assert.equal(
    normalizeParentReportWorkflowState("notification_queued"),
    "notification_queued"
  )
  assert.equal(
    normalizeParentReportWorkflowState("notification_sent"),
    "notification_sent"
  )
})

test("parent report workflow module exports submission, staging, approval, and acknowledgement hooks", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/parent-reports.mjs", import.meta.url), "utf8")
  assert.match(source, /export async function submitParentClassReportForAdminReview\(/)
  assert.match(source, /export async function startParentClassReportAdminReview\(/)
  assert.match(source, /export async function markParentClassReportAwaitingApproval\(/)
  assert.match(source, /export async function acknowledgeParentClassReportReview\(/)
  assert.match(source, /finalArtifactPayload/)
  assert.match(source, /workflowState/)
})

test("announcement worker no longer approves parent reports during email send", () => {
  const source = fs.readFileSync(new URL("../src/modules/async/side-effect-worker.mjs", import.meta.url), "utf8")
  assert.doesNotMatch(source, /approveParentClassReport/)
  assert.match(source, /notification_sent/)
})

test("student news save/list paths keep model-drift fallback guards", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const submissions = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")
  assert.match(source, /from "\.\.\/src\/modules\/admin\/student-news-submissions\.mjs"/)
  assert.doesNotMatch(source, /student-news-fallback\.mjs/)
  assert.doesNotMatch(source, /student-news-compliance\.mjs/)
  assert.doesNotMatch(source, /function resolveStudentNewsSubmissionWindow\(/)
  assert.doesNotMatch(source, /function mapStudentNewsReportRow\(/)
  assert.doesNotMatch(source, /function buildStudentNewsCalendarRows\(/)
  assert.doesNotMatch(source, /async function listStudentNewsCalendar\(/)
  assert.doesNotMatch(source, /async function saveStudentNewsReport\(/)
  assert.doesNotMatch(source, /function normalizeStudentNewsReviewStatus\(/)
  assert.doesNotMatch(source, /function resolveStudentNewsStatusColor\(/)
  assert.match(submissions, /isStudentNewsReportSchemaUnavailableError\(/)
  assert.match(submissions, /listStudentNewsReportsFromFallbackStore\(/)
  assert.match(submissions, /upsertStudentNewsReportInFallbackStore\(/)
  assert.match(submissions, /export function resolveStudentNewsSubmissionWindow\(/)
  assert.match(submissions, /export function buildStudentNewsCalendarRows\(/)
  assert.match(submissions, /export async function listStudentNewsCalendar\(/)
  assert.match(submissions, /export async function saveStudentNewsReport\(/)
})

test("student news save keeps open-date restriction for new rows and allows non-approved resubmits through Saturday 23:59 (UTC+7)", () => {
  const store = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const submissions = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")

  assert.doesNotMatch(store, /if \(!existing\) \{\s*assertWithStatus\(reportDateText === window\.reportDate, 403, "News report for this date is locked"\)\s*\}/s)
  assert.doesNotMatch(store, /const nowDate = parseDateOrNull\(now\) \|\| new Date\(\)/)
  assert.doesNotMatch(store, /const currentWeekStart = startOfWeekSunday\(nowDate\)/)
  assert.doesNotMatch(store, /const weeklyResubmitCutoff = new Date\(currentWeekStart\.getTime\(\) \+ \(ONE_DAY_MS \* 7\)\)/)
  assert.doesNotMatch(store, /const isBeforeWeeklyResubmitCutoff = nowDate < weeklyResubmitCutoff/)
  assert.doesNotMatch(store, /const isCurrentWeekReportDate = reportDate >= currentWeekStart && reportDate < weeklyResubmitCutoff/)
  assert.doesNotMatch(store, /assertWithStatus\(\s*isBeforeWeeklyResubmitCutoff && isCurrentWeekReportDate,\s*403,\s*"News report for this date is locked"\s*\)/s)
  assert.doesNotMatch(store, /const isApproved = existingStatus === STUDENT_NEWS_REVIEW_STATUS_APPROVED/)
  assert.doesNotMatch(store, /assertWithStatus\(!isApproved, 403, "Approved news reports cannot be edited"\)/)
  assert.doesNotMatch(store, /const isResubmission = Boolean\(existing\)/)
  assert.doesNotMatch(store, /const reviewStatus = hasFailures && !isResubmission/)
  assert.doesNotMatch(store, /Status remains waiting for admin review\./)
  assert.doesNotMatch(store, /hasPrismaDelegateMethod\(prisma, "studentNewsReport", "findFirst"\)/)
  assert.doesNotMatch(store, /reportDate:\s*\{\s*gte:\s*reportDateRangeStart,\s*lt:\s*reportDateRangeEnd,\s*\}/s)
  assert.doesNotMatch(store, /const fallbackExisting = listStudentNewsReportsFromFallbackStore\(id, \{\s*startDate: reportDateText,\s*endDate: reportDateText,\s*\}\)/s)
  assert.doesNotMatch(store, /const existingId = normalizeText\(existing\?\.id\)/)
  assert.doesNotMatch(store, /prisma\.studentNewsReport\.update\(\{\s*where:\s*\{\s*id:\s*existingId\s*\},\s*data:\s*reportData,\s*\}\)/s)

  assert.match(submissions, /if \(!existing\) \{\s*assertWithStatus\(reportDateText === window\.reportDate, 403, "News report for this date is locked"\)\s*\}/s)
  assert.match(submissions, /const nowDate = parseDateOrNull\(now\) \|\| new Date\(\)/)
  assert.match(submissions, /const currentWeekStart = startOfWeekSunday\(nowDate\)/)
  assert.match(submissions, /const weeklyResubmitCutoff = new Date\(currentWeekStart\.getTime\(\) \+ \(ONE_DAY_MS \* 7\)\)/)
  assert.match(submissions, /const isBeforeWeeklyResubmitCutoff = nowDate < weeklyResubmitCutoff/)
  assert.match(submissions, /const isCurrentWeekReportDate = reportDate >= currentWeekStart && reportDate < weeklyResubmitCutoff/)
  assert.match(submissions, /assertWithStatus\(\s*isBeforeWeeklyResubmitCutoff && isCurrentWeekReportDate,\s*403,\s*"News report for this date is locked"\s*\)/s)
  assert.match(submissions, /const isApproved = existingStatus === STUDENT_NEWS_REVIEW_STATUS_APPROVED/)
  assert.match(submissions, /assertWithStatus\(!isApproved, 403, "Approved news reports cannot be edited"\)/)
  assert.match(submissions, /const isResubmission = Boolean\(existing\)/)
  assert.match(submissions, /const reviewStatus = hasFailures && !isResubmission/)
  assert.match(submissions, /Status remains waiting for admin review\./)
  assert.match(submissions, /hasPrismaDelegateMethod\(prisma, "studentNewsReport", "findFirst"\)/)
  assert.match(submissions, /reportDate:\s*\{\s*gte:\s*reportDateRangeStart,\s*lt:\s*reportDateRangeEnd,\s*\}/s)
  assert.match(submissions, /const fallbackExisting = listStudentNewsReportsFromFallbackStore\(id, \{\s*startDate: reportDateText,\s*endDate: reportDateText,\s*\}\)/s)
  assert.match(submissions, /const existingId = normalizeText\(existing\?\.id\)/)
  assert.match(submissions, /prisma\.studentNewsReport\.update\(\{\s*where:\s*\{\s*id:\s*existingId\s*\},\s*data:\s*reportData,\s*\}\)/s)
})

test("student news save refreshes submittedAt on each allowed submission", () => {
  const store = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const submissions = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")

  assert.doesNotMatch(store, /const submittedAt = new Date\(\)/)
  assert.doesNotMatch(store, /const reportData = \{[\s\S]*submittedAt,[\s\S]*reviewStatus,/s)
  assert.match(submissions, /const submittedAt = new Date\(\)/)
  assert.match(submissions, /const reportData = \{[\s\S]*submittedAt,[\s\S]*reviewStatus,/s)
})

test("student news review queue lives in the dedicated review module", () => {
  const store = fs.readFileSync(new URL("../server/student-admin-store.mjs", import.meta.url), "utf8")
  const compliance = fs.readFileSync(new URL("../src/modules/admin/student-news-compliance.mjs", import.meta.url), "utf8")
  const fallback = fs.readFileSync(new URL("../src/modules/admin/student-news-fallback.mjs", import.meta.url), "utf8")
  const review = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")

  assert.doesNotMatch(store, /student-news-compliance\.mjs/)
  assert.doesNotMatch(store, /student-news-fallback\.mjs/)
  assert.match(compliance, /export function buildStudentNewsComplianceBlock\(/)
  assert.match(compliance, /export function normalizeValidationIssueMap\(/)
  assert.match(compliance, /export function mergeStudentNewsReviewNoteWithCompliance\(/)
  assert.match(compliance, /export async function evaluateStudentNewsCompliance\(/)
  assert.match(compliance, /export function updateStudentNewsValidationIssues\(/)
  assert.match(fallback, /export \{\s*buildStudentNewsFallbackOverlayIndex,/)
  assert.match(fallback, /export \{\s*buildStudentNewsFallbackOverlayIndex,[\s\S]*resolveStudentNewsFallbackReviewOverlay,/)
  assert.match(fallback, /export \{\s*buildStudentNewsFallbackOverlayIndex,[\s\S]*upsertStudentNewsReportInFallbackStore,/)

  assert.match(review, /from "\.\/student-news-fallback\.mjs"/)
  assert.match(review, /from "\.\/student-news-compliance\.mjs"/)
  assert.match(review, /export async function listStudentNewsReportsForReview\(/)
  assert.match(review, /export async function reviewStudentNewsReport\(/)
  assert.match(review, /function buildStudentNewsReviewSelect\(/)
  assert.match(review, /function resolveStudentNewsReviewActionStatus\(/)
  assert.match(review, /buildStudentNewsFallbackOverlayIndex\(/)
  assert.match(review, /resolveStudentNewsFallbackReviewOverlay\(/)
  assert.match(review, /readStudentNewsFallbackEntries\(/)
  assert.match(review, /upsertStudentNewsReportInFallbackStore\(/)
  assert.match(review, /normalizeStudentNewsReviewStatus\(/)
  assert.match(review, /resolveStudentNewsStatusColor\(/)
  assert.match(review, /normalizeStudentNewsReviewTake\(/)

  assert.doesNotMatch(store, /export function buildStudentNewsComplianceBlock\(/)
  assert.doesNotMatch(store, /export async function evaluateStudentNewsCompliance\(/)
  assert.doesNotMatch(store, /export function normalizeValidationIssueMap\(/)
  assert.doesNotMatch(store, /export function updateStudentNewsValidationIssues\(/)
  assert.doesNotMatch(store, /export async function listStudentNewsReportsForReview\(/)
  assert.doesNotMatch(store, /export async function reviewStudentNewsReport\(/)
  assert.doesNotMatch(store, /function buildStudentNewsReviewSelect\(/)
  assert.doesNotMatch(store, /function resolveStudentNewsReviewActionStatus\(/)
})

test("parent routes keep legacy parent-report metadata backfill guards", () => {
  const source = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")
  assert.match(source, /function backfillLegacyParentReportMetadataRows\(/)
  assert.match(source, /function buildLegacyReportMetaPayload\(/)
  assert.match(source, /decodeLegacyParentReportCommentBundle\(/)
  assert.match(source, /await backfillLegacyParentReportMetadataRows\(\{\s*prisma,\s*reportRows,\s*gradeRows/s)
  assert.match(source, /async function getStudentByIdWithReportBackfill\(/)
})
