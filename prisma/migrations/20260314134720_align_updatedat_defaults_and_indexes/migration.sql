-- DropIndex
DROP INDEX "Student_eaglesId_idx";

-- AlterTable
ALTER TABLE "ParentPortalAccount" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ParentProfileFieldLock" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ParentProfileSubmissionQueue" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StudentNewsReport" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StudentPointsAdjustment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StudentPortalAccount" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "ParentProfileSubmissionQueue_parentAccountId_status_createdAt_i" RENAME TO "ParentProfileSubmissionQueue_parentAccountId_status_created_idx";
