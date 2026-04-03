-- AlterTable
ALTER TABLE "AdminNotificationQueue" ADD COLUMN     "parentReviewedAt" TIMESTAMP(3),
ADD COLUMN     "parentReviewedByUsername" TEXT,
ADD COLUMN     "studentReviewedAt" TIMESTAMP(3),
ADD COLUMN     "studentReviewedByUsername" TEXT;
