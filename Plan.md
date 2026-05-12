Plan

Quarter Grade Tabulator
Summary
Replace the student and parent Grade Timeline calendar with a simple quarter-stacked grade table. The table should be control-free by default, use the established admin header/table styling, and show the current quarter first. No calendar is needed in the grade table detail view.

Key Changes
Replace the grade timeline calendar in the dedicated grades-ytd surfaces for student and parent with a quarter group tabulator.
Derive quarter membership from grade record dates, not from a stored quarter label.
Sort quarter groups with the current quarter first, then older quarters below it.
Render each quarter row with lay-person friendly stats:
running mean
mean score as percent and /10 equivalent
number of completed assignments
number of uncompleted assignments
total assignments and completion rate
explicit zero values where applicable
Keep the default view free of extra controls.
If a modal is helpful, use it only for the current quarter summary, not as a required navigation layer.
Reuse the existing admin table/header styling language so the new surface matches the admin grade experience.
Test Plan
Add coverage for student and parent grade surfaces to confirm:
quarter rows are derived from dates
current quarter appears first
the requested stats render correctly
zero values render explicitly
no calendar is shown in the grade detail surface
Verify the student and parent views remain consistent with each other for the same grade data set.
Run the existing admin UI and HTML parity checks after the change so shared styling and grade-related wiring remain intact.
Assumptions
Only the dedicated grade timeline surfaces are changing.
Grade rows do not need a stored quarter field for this UI; quarter is derived from the row dates.
The grade table detail should not include a calendar.

Mock Test Results Page
Purpose
Build the official Cambridge, ETS, and IELTS mock test results surface.
Each proficiency level uses its own variant so the page can change math, subsections, and display rules per level.
Each variant should codify its own scoring logic instead of reusing a single generic results template.

Key Changes
Expose a dedicated results page for each test family and level.
Keep result math variant-specific per level.
Allow different subsections per level so Cambridge, ETS, and IELTS can present the right breakdowns.
Treat the results page as an official results surface, not a generic practice dashboard.
Codify the level-to-variant mapping in the plan before implementation.







