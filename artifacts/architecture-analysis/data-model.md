# Data model

## Database architecture

The Prisma schema defines a PostgreSQL multi-schema design with `public` and `library` schemas. The app uses a shared Prisma client and heavily relies on a rich, relational domain model rather than a simple key-value store.

## Core public-domain entities

### Student and profile lifecycle

- `Student` — base identity and enrollment relationship anchor.
- `StudentProfile` — profile details tied to the student record.
- `StudentPortalAccount` — student-facing portal credential/account record.
- `ParentPortalAccount` and `ParentPortalStudentLink` — parent auth and relationship linking.
- `ParentProfileInvitation` / `ParentProfileSubmissionQueue` / `ParentProfileFieldLock` — parent profile setup and verification workflows.

### Academic and operational records

- `Exercise` and `ExerciseSubmission` — instructional exercises and captured results.
- `IncomingExerciseResult` — imported or asynchronously reconciled exercise results.
- `StudentAttendance`, `StudentGradeRecord`, `StudentEnrollmentPeriod`, `ParentClassReport` — academic tracking and reporting.
- `StudentNewsReport`, `StudentNewWord` — reported work and vocabulary entries.
- `AssignmentTemplate` — reusable assignment bundle definitions.
- `StudentPointsAdjustment`, `SchoolSetup`, `SisConfigMirror`, `PortalPreference`, `PortalAsset` — configuration, preference, and runtime asset persistence.

### Admin and queue infrastructure

- `AdminUser` / `AdminUserRole` — admin/teacher identity model.
- `AsyncSideEffectJob` — background jobs and delayed effects.
- `BrevoEmailDelivery` and related webhook/event tables — email operations and webhook auditing.
- `AdminNotificationQueue` — communication dispatch orchestration.

## Schema patterns

The schema consistently uses:

- CUID IDs as primary keys for many models.
- explicit foreign keys and `onDelete`/`onUpdate` constraints.
- JSON payload columns for flexible data such as portal settings, assignment bundles, imported results, and metadata.
- unique constraints such as student identity keys, source-system deduplication, and form field identities.
- index patterns for common lookups by `studentRefId`, `submittedEaglesId`, `updatedAt`, and workflow status.

## Library schema

The `library` schema adds specialized models for library corpus entities and educational reference data. This is a separate domain from the school administration core, with its own cataloging and review surface.

## Notable design characteristics

- A large amount of workflow state is stored in the database rather than in ephemeral memory.
- The app tracks both authoritative identity data and imported/external source values, especially for exercise results and student intake data.
- The model supports both operational school processing and portal-facing personalization.
- Configuration is persisted as structured JSON and mirrored into `SisConfigMirror` for runtime consistency.

## Architectural implication

The data model is rich and extends across many administrative workflows. For upgrades or migrations, the main risk is not the schema size itself but the breadth of integration points: roster, attendance, portal preferences, assignment templates, reporting, and asynchronous jobs all reference each other across the same operational DB.
