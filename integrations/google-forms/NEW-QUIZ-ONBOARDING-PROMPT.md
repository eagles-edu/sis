# Reusable AI prompt: add a Google Forms quiz to SIS

Copy the prompt below and provide the new form link and the approved test student EaglesID. Keep the work in the test mirror unless the user explicitly authorizes a different environment.

---

## Prompt

Add this Google Forms quiz to our existing Google Forms → Sheets → Apps Script → SIS grade flow:

- Google Form: `{{FORM_URL}}`
- Test student EaglesID: `{{TEST_EAGLES_ID}}`
- SIS target: test mirror only, `https://test.eagles.edu.vn`
- Shared response workbook: `gform_grades_26-27`, ID `1HKHHbfa3UMyaAbf5XhR9B7NcorelL23Xpdx7A1rB3-o`
- Shared Apps Script project: [Google Forms Grade Upload — Bees](https://script.google.com/home/projects/1Ce_TAP7ihvR87nY1KBD0rU315M_TfRTVrLyyM5Ir34E3xUXI0GqsVrCn/edit)

Use the current quiz settings and existing integration. Do not create a new workbook or a separate sender project for this quiz. Do not expose, copy, or print any secret. Do not post grades through the cookie-session admin route or to live SIS.

### 1. Inspect the form

1. Open the supplied form in its editor and use its exact visible title as the SIS assignment title.
2. Record the form's point total from **Total points**. Verify every scored question has an answer key, is required, and is worth 1 point. The form total must equal the sum of its scored question points.
3. Keep the identity fields `Name` and `EaglesID` as required short-answer questions. Keep email collection enabled.
4. For multiple-choice questions, verify the correct option by its text. Correct answers must vary across option positions; do not assume every correct answer is option A. Keep the quiz's shuffled question order enabled.
5. Preserve these verified form settings:
   - **Make this a quiz:** on.
   - **Release grades:** immediately after each submission.
   - **Respondent settings:** show missed questions, correct answers, and point values.
   - **Default question point value:** 0; explicitly set each scored question to 1 point.
   - **Collect email addresses:** responder input.
   - **Send responders a copy:** when requested.
   - **Allow response editing:** on.
   - **Limit to 1 response:** off.
   - **Show progress bar:** on.
   - **Shuffle question order:** on.
   - **Show link to submit another response:** on.
   - **View results summary:** on.
   - **Disable autosave:** off.
6. Do not change these settings while onboarding. If the supplied form differs, report each difference and ask before changing the form.

### 2. Link and name the response worksheet

1. In the form's **Responses** tab, link the form to the existing workbook above by choosing the option to select an existing spreadsheet. Do not create a separate spreadsheet.
2. Confirm Google Forms created a separate worksheet for this quiz in that workbook.
3. Rename only that response tab to the exact form title, limited to 60 characters. If the title is longer, use its first 60 characters and trim trailing spaces. If Google Sheets rejects title characters, replace only the rejected characters with spaces, then enforce the 60-character limit. Preserve the existing response data and the worksheet's `sheetId`.
4. Read the response header row and confirm it contains `Timestamp`, `Email Address`, `Score`, `Name`, and `EaglesID`. The Apps Script depends on the exact `Score` and `EaglesID` header names. Do not edit response rows or change the form's response columns.

### 3. Add the quiz to the shared Apps Script

1. Inspect the existing project, its Script Properties, and its triggers before changing anything. Confirm the existing test base URL and trigger source; do not reveal the secret value.
2. Use the complete source in `integrations/google-forms/grades.gs`. Keep one spreadsheet form-submit trigger for this shared workbook and one quiz configuration entry per response tab. Remove only a verified duplicate or stale trigger owned by this project.
3. Add one object to `SIS_GRADES_QUIZZES_JSON` with:

   ```json
   {
     "spreadsheetId": "1HKHHbfa3UMyaAbf5XhR9B7NcorelL23Xpdx7A1rB3-o",
     "sheetId": 123456789,
     "title": "Exact Google Form title",
     "maxScore": 50
   }
   ```

   Replace `sheetId` with the worksheet's numeric `gid`, `title` with the full exact form title, and `maxScore` with the verified form total. Keep `maxScore` even when the Sheet's `Score` cell includes a denominator.
4. Keep `SIS_GRADES_BASE_URL` set to `https://test.eagles.edu.vn` and preserve the already configured test-only `SIS_GRADES_SECRET`. On the test SIS runtime, verify `GOOGLE_FORMS_GRADES_SECRET` is configured to the matching secret without printing or moving the secret between environments.
5. Run `installGoogleFormsGradesTriggers` once if the existing spreadsheet trigger is absent or stale. Authorize the requested spreadsheet and external-request scopes. Verify exactly one form-submit trigger for the shared workbook.
6. Verify the code signs UTF-8 request content and posts to `/api/integrations/google-forms/grades`. Do not replace this signed integration with `/api/admin/students/:id/grades`; that admin route requires a browser cookie session.

### 4. Test the complete path

1. Submit the form through its respondent page as the approved test student. Use the form's actual correct answer text and vary selected option positions; do not submit the same letter for every question. The test may be a full-score submission when the answer key has been verified.
2. Verify the respondent confirmation and score page.
3. Verify the new row in the correctly named response tab. Confirm its `EaglesID`, `Name`, `Score`, and denominator match the submission and configured maximum.
4. Verify the corresponding Apps Script execution is **Completed**. If it failed, inspect the execution error and fix that cause before retrying.
5. Log in to the test mirror with an admin session and verify the record on `/admin/grades-data` and in the student's grade records. Confirm the exact assignment title, score, `maxScore`, `sourceSystem: "google-forms"`, and stable source attempt ID. Confirm class, school year, and quarter are the values SIS derives from the student's active enrollment and current authoritative school setup; do not add those as form fields or script properties.
6. Confirm that the grade is persisted in the test database and appears in the authenticated admin UI. A Form confirmation, Sheet row, completed script execution, or HTTP 200 alone is not sufficient proof.
7. Report each verified hop and any remaining failure separately. Never claim a grade was posted unless the test SIS record and authenticated Grades UI both show it.

---

## Current shared workbook

The existing response tabs are:

| Form title | Worksheet name | `sheetId` | Configured maximum |
| --- | --- | ---: | ---: |
| The Ecological Importance of Bees | The Ecological Importance of Bees — Mixed Answer Version | 660086055 | 56 |
| Australian Artist Margaret Preston | Australian Artist Margaret Preston — Mixed Answer Version | 527690905 | 67 |
| Nature works Polylactic acid | Nature works Polylactic acid | 2116696939 | 50 |

The Bees and Margaret Preston workbook tabs retain their current names. New quiz tabs use the form title rule above. The current SIS assignment titles for the first two existing records include `— Mixed Answer Version`; preserve existing grades unless the user explicitly asks to rename or replay them.
