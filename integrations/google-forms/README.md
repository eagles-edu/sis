# Google Forms grade posting

The Apps Script sender posts each response row to the signed SIS endpoint:

`POST https://test.eagles.edu.vn/api/integrations/google-forms/grades`

The test endpoint is disabled until `GOOGLE_FORMS_GRADES_SECRET` is configured in that runtime. It uses a separate HMAC secret, a five-minute timestamp window, one-use nonces, and the response row's stable attempt ID. Reprocessing the same row updates the same grade record.

For a reusable, step-by-step prompt for adding a quiz, use [NEW-QUIZ-ONBOARDING-PROMPT.md](NEW-QUIZ-ONBOARDING-PROMPT.md).

## Minimum grade data

The SIS grade values required from each form are:

- `EaglesID` — resolves the student
- `Score` — accepts a `score / maximum` value, or a number paired with that quiz's configured `maxScore`
- `maxScore` — required by SIS to calculate the percentage; Apps Script reads it from `Score` or the quiz configuration
- the form title — saved as the grade assignment title

The grade is recorded in the school year and quarter current when SIS receives it. SIS derives that period from its authoritative school setup and derives class from the student's single active enrollment for that school year. The form's response timestamp does not select the grade period. SIS rejects submissions when school setup is invalid or the student has no single active enrollment with a level. Class, school year, and quarter are not form fields or Script Properties.

The response sheets also contain `Timestamp`, `Email Address`, `Name`, and quiz-question columns. The sender ignores those columns. The Apps Script calculates a stable attempt ID from the response sheet and row so retries update the same grade record.

## Configure one Apps Script for many quizzes

Use one spreadsheet with a separate response worksheet for each quiz, plus one standalone Apps Script project for all those quizzes. Each quiz entry points to the workbook and its worksheet ID (`gid` in the worksheet URL), then supplies the grade title. The forms must be linked to that same spreadsheet. An optional `maxScore` is used when that worksheet's `Score` cell has no denominator.

1. Link each Google Form to the same response spreadsheet, choosing the option to select an existing spreadsheet. Google Forms creates a separate response worksheet for each form. Create one standalone Apps Script project and add the contents of `grades.gs`.
2. In **Project Settings → Script Properties**, set `SIS_GRADES_BASE_URL`, `SIS_GRADES_SECRET`, and `SIS_GRADES_QUIZZES_JSON`. The JSON property is an array, for example:

```json
[
  {
    "spreadsheetId": "1HKHHbfa3UMyaAbf5XhR9B7NcorelL23Xpdx7A1rB3-o",
    "sheetId": 527690905,
    "title": "Australian Artist Margaret Preston — Mixed Answer Version"
  },
  {
    "spreadsheetId": "1HKHHbfa3UMyaAbf5XhR9B7NcorelL23Xpdx7A1rB3-o",
    "sheetId": 660086055,
    "title": "The Ecological Importance of Bees — Mixed Answer Version"
  },
  {
    "spreadsheetId": "1HKHHbfa3UMyaAbf5XhR9B7NcorelL23Xpdx7A1rB3-o",
    "sheetId": 2116696939,
    "title": "Nature works Polylactic acid",
    "maxScore": 50
  }
]
```

Use the same shared spreadsheet ID on every entry. The IDs above are the current response worksheets; for another quiz, use the `gid` from its worksheet URL. Include `"maxScore": 20` for a quiz whose `Score` cells contain only a number; use its actual maximum.

3. Select and run `installGoogleFormsGradesTriggers` once, then authorize spreadsheet and external-request access. It installs one form-submit trigger per configured spreadsheet and removes stale or duplicate triggers owned by that Apps Script project.
4. New form submissions trigger posting. Existing responses are not replayed by installing triggers. Apps Script execution details show only the HTTP status on failure; they do not log the secret or response body.

Use a separate Apps Script secret and base URL for dev, test, and live. Configure the same environment-specific secret as `GOOGLE_FORMS_GRADES_SECRET` on the matching SIS runtime, and set `SIS_GRADES_BASE_URL` to that environment's origin. Never copy a secret between environment files. Live posting remains disabled until the live runtime is explicitly configured and updated with this route.
