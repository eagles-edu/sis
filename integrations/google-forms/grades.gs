const GOOGLE_FORMS_GRADES_ENDPOINT = "/api/integrations/google-forms/grades";
const GOOGLE_FORMS_GRADES_HANDLER = "submitGoogleFormsGrade";

function installGoogleFormsGradesTriggers() {
  const quizzes = getGoogleFormsGradeQuizzes_();
  const spreadsheetIds = Array.from(new Set(quizzes.map((quiz) => quiz.spreadsheetId)));
  const spreadsheets = spreadsheetIds.map((spreadsheetId) => ({
    spreadsheetId,
    spreadsheet: SpreadsheetApp.openById(spreadsheetId),
  }));
  const desiredSpreadsheetIds = new Set(spreadsheetIds);
  const retainedSpreadsheetIds = new Set();

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === GOOGLE_FORMS_GRADES_HANDLER)
    .forEach((trigger) => {
      const spreadsheetId = trigger.getTriggerSourceId();
      const isFormSubmit = trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT;
      if (
        desiredSpreadsheetIds.has(spreadsheetId)
        && isFormSubmit
        && !retainedSpreadsheetIds.has(spreadsheetId)
      ) {
        retainedSpreadsheetIds.add(spreadsheetId);
        return;
      }
      ScriptApp.deleteTrigger(trigger);
    });

  spreadsheets.forEach(({ spreadsheetId, spreadsheet }) => {
    if (retainedSpreadsheetIds.has(spreadsheetId)) return;
    ScriptApp.newTrigger(GOOGLE_FORMS_GRADES_HANDLER)
      .forSpreadsheet(spreadsheet)
      .onFormSubmit()
      .create();
  });
}

function installGoogleFormsGradesTrigger() {
  installGoogleFormsGradesTriggers();
}

function submitGoogleFormsGrade(event) {
  if (!event || !event.range) {
    throw new Error("This function must run from a spreadsheet form-submit trigger.");
  }

  const sheet = event.range.getSheet();
  const spreadsheetId = sheet.getParent().getId();
  const sheetId = sheet.getSheetId();
  const matches = getGoogleFormsGradeQuizzes_().filter((item) => (
    item.spreadsheetId === spreadsheetId
    && (item.sheetId === null || item.sheetId === sheetId)
  ));
  if (matches.length !== 1) {
    throw new Error("No quiz configuration matches the form response spreadsheet.");
  }
  const quiz = matches[0];

  const properties = PropertiesService.getScriptProperties();
  const baseUrl = String(properties.getProperty("SIS_GRADES_BASE_URL") || "").trim().replace(/\/+$/, "");
  const secret = String(properties.getProperty("SIS_GRADES_SECRET") || "");
  if (!/^https:\/\//i.test(baseUrl) || !secret) {
    throw new Error("Set SIS_GRADES_BASE_URL and SIS_GRADES_SECRET in Script Properties.");
  }

  const rowNumber = event.range.getRow();
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
  const answers = {};
  headers.forEach((header, index) => {
    const normalizedHeader = String(header || "").trim();
    if (normalizedHeader) answers[normalizedHeader] = values[index];
  });

  const eaglesId = gradeCellValue_(answers.EaglesID);
  if (!eaglesId) throw new Error("Required response is empty: EaglesID");

  const score = parseGoogleFormsScore_(answers.Score, quiz.maxScore);
  const payload = {
    eaglesId,
    title: quiz.title,
    score: score.score,
    maxScore: score.maxScore,
    sourceAttemptId: "google_forms_" + gradeSha256Hex_(
      [spreadsheetId, sheet.getSheetId(), rowNumber].join(":"),
    ),
  };

  const body = JSON.stringify(payload);
  const source = "google-forms-grades";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const signingInput = [source, timestamp, nonce, body].join("\n");
  const signature = gradeBytesToHex_(Utilities.computeHmacSha256Signature(
    signingInput,
    secret,
    Utilities.Charset.UTF_8,
  ));
  const response = UrlFetchApp.fetch(baseUrl + GOOGLE_FORMS_GRADES_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    payload: body,
    headers: {
      "X-SIS-Source": source,
      "X-SIS-Timestamp": timestamp,
      "X-SIS-Nonce": nonce,
      "X-SIS-Signature": signature,
    },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("SIS grade submission failed with HTTP " + status + ". Check the Apps Script execution details.");
  }
}

function getGoogleFormsGradeQuizzes_() {
  const raw = String(
    PropertiesService.getScriptProperties().getProperty("SIS_GRADES_QUIZZES_JSON") || "",
  ).trim();
  if (!raw) {
    throw new Error("Set SIS_GRADES_QUIZZES_JSON to an array of quiz spreadsheet IDs and titles.");
  }

  let quizzes;
  try {
    quizzes = JSON.parse(raw);
  } catch (error) {
    throw new Error("SIS_GRADES_QUIZZES_JSON must contain valid JSON.");
  }
  if (!Array.isArray(quizzes) || quizzes.length === 0) {
    throw new Error("SIS_GRADES_QUIZZES_JSON must contain at least one quiz.");
  }

  const seenQuizKeys = new Set();
  const parsedQuizzes = quizzes.map((quiz, index) => {
    const spreadsheetId = String(quiz && quiz.spreadsheetId || "").trim();
    const sheetIdText = String(quiz && quiz.sheetId !== undefined ? quiz.sheetId : "").trim();
    const sheetId = sheetIdText ? Number(sheetIdText) : null;
    const title = String(quiz && quiz.title || "").trim();
    const maxScoreText = String(quiz && quiz.maxScore !== undefined ? quiz.maxScore : "").trim();
    const maxScore = maxScoreText ? Number(maxScoreText) : null;
    if (!spreadsheetId || !title) {
      throw new Error("Each quiz configuration needs spreadsheetId and title (entry " + (index + 1) + ").");
    }
    if (sheetIdText && (!Number.isInteger(sheetId) || sheetId < 0)) {
      throw new Error("Quiz sheetId must be a non-negative integer (entry " + (index + 1) + ").");
    }
    if (maxScoreText && (!Number.isFinite(maxScore) || maxScore <= 0)) {
      throw new Error("Quiz maxScore must be a positive number (entry " + (index + 1) + ").");
    }
    const quizKey = spreadsheetId + ":" + (sheetId === null ? "*" : sheetId);
    if (seenQuizKeys.has(quizKey)) {
      throw new Error("A spreadsheet and worksheet pair appears more than once in SIS_GRADES_QUIZZES_JSON.");
    }
    seenQuizKeys.add(quizKey);
    return { spreadsheetId, sheetId, title, maxScore };
  });
  const spreadsheetMatchCounts = new Map();
  parsedQuizzes.forEach((quiz) => {
    const counts = spreadsheetMatchCounts.get(quiz.spreadsheetId) || { total: 0, withoutSheetId: 0 };
    counts.total += 1;
    if (quiz.sheetId === null) counts.withoutSheetId += 1;
    spreadsheetMatchCounts.set(quiz.spreadsheetId, counts);
  });
  if (Array.from(spreadsheetMatchCounts.values()).some((counts) => (
    counts.total > 1 && counts.withoutSheetId > 0
  ))) {
    throw new Error("Use a distinct sheetId for every quiz when multiple quizzes share one spreadsheet.");
  }
  return parsedQuizzes;
}

function gradeCellValue_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function gradeSha256Hex_(value) {
  return gradeBytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}

function parseGoogleFormsScore_(value, configuredMaxScore) {
  const scoreText = gradeCellValue_(value);
  const match = scoreText.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/);
  if (!match) throw new Error("The Score response must be a number or a score/max-score value.");

  const score = Number(match[1]);
  const maxScoreText = match[2] || String(configuredMaxScore === null ? "" : configuredMaxScore || "").trim();
  if (!maxScoreText) {
    throw new Error("Add maxScore to this quiz configuration when the Score cell does not include its maximum.");
  }
  const maxScore = Number(maxScoreText);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    throw new Error("The Score response or configured maximum is invalid.");
  }
  return { score, maxScore };
}

function gradeBytesToHex_(bytes) {
  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
}
