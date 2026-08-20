ALTER TABLE "public"."AssignmentReminderEngagement"
  ADD COLUMN "proxyLoadedAt" TIMESTAMP(3),
  ADD COLUMN "firstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "uniqueOpenedAt" TIMESTAMP(3);

ALTER TABLE "public"."ParentProfileInvitation"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "proxyLoadedAt" TIMESTAMP(3),
  ADD COLUMN "firstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "uniqueOpenedAt" TIMESTAMP(3);
