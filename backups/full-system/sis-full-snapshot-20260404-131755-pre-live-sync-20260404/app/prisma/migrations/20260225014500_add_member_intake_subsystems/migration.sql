-- CreateEnum
CREATE TYPE "IntakeControlType" AS ENUM ('text', 'textarea', 'number', 'email', 'select', 'checkbox', 'radio', 'date', 'unknown', 'meta');

-- CreateTable
CREATE TABLE "IntakeFieldDefinition" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fieldKey" INTEGER NOT NULL,
    "dataName" TEXT NOT NULL,
    "label" TEXT,
    "controlType" "IntakeControlType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sourceOrder" INTEGER NOT NULL,
    "optionsJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "sourceFormId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fullName" TEXT,
    "englishName" TEXT,
    "genderSelections" TEXT[] NOT NULL,
    "studentPhone" TEXT,
    "studentEmail" TEXT,
    "hobbies" TEXT,
    "dobText" TEXT,
    "birthOrder" INTEGER,
    "siblingBrothers" INTEGER,
    "siblingSisters" INTEGER,
    "ethnicity" TEXT,
    "languagesAtHome" TEXT[] NOT NULL,
    "otherLanguage" TEXT,
    "schoolName" TEXT,
    "currentGrade" TEXT,
    "motherName" TEXT,
    "motherEmail" TEXT,
    "motherPhone" TEXT,
    "motherEmergencyContact" TEXT,
    "motherMessenger" TEXT,
    "fatherName" TEXT,
    "fatherEmail" TEXT,
    "fatherPhone" TEXT,
    "fatherEmergencyContact" TEXT,
    "fatherMessenger" TEXT,
    "streetAddress" TEXT,
    "wardDistrict" TEXT,
    "city" TEXT,
    "hasGlasses" TEXT,
    "hadEyeExam" TEXT,
    "lastEyeExamDateText" TEXT,
    "prescriptionMedicine" TEXT,
    "prescriptionDetails" TEXT,
    "learningDisorders" TEXT[] NOT NULL,
    "learningDisorderDetails" TEXT,
    "drugAllergies" TEXT,
    "foodEnvironmentalAllergies" TEXT,
    "vaccinesChildhoodUpToDate" TEXT,
    "hadCovidPositive" TEXT,
    "covidNegativeDateText" TEXT,
    "covidShotAlready" TEXT,
    "covidVaccinesUpToDate" TEXT,
    "covidShotHistory" TEXT[] NOT NULL,
    "mostRecentCovidShotDate" TEXT,
    "feverMedicineAllowed" TEXT[] NOT NULL,
    "whiteOilAllowed" TEXT,
    "signatureFullName" TEXT,
    "signatureEmail" TEXT,
    "extraComments" TEXT,
    "requiredValidationOk" BOOLEAN,
    "rawFormPayload" JSONB,
    "normalizedFormPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentIntakeSubmission" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "sourceFormId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "fieldsJson" JSONB NOT NULL,
    "missingRequiredJson" JSONB,
    "requiredValidationOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentIntakeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFieldDefinition_formId_fieldKey_key" ON "IntakeFieldDefinition"("formId", "fieldKey");

-- CreateIndex
CREATE INDEX "IntakeFieldDefinition_formId_dataName_idx" ON "IntakeFieldDefinition"("formId", "dataName");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_studentRefId_key" ON "StudentProfile"("studentRefId");

-- CreateIndex
CREATE INDEX "StudentProfile_sourceFormId_createdAt_idx" ON "StudentProfile"("sourceFormId", "createdAt");

-- CreateIndex
CREATE INDEX "StudentIntakeSubmission_studentRefId_submittedAt_idx" ON "StudentIntakeSubmission"("studentRefId", "submittedAt");

-- CreateIndex
CREATE INDEX "StudentIntakeSubmission_sourceFormId_submittedAt_idx" ON "StudentIntakeSubmission"("sourceFormId", "submittedAt");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentIntakeSubmission" ADD CONSTRAINT "StudentIntakeSubmission_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
