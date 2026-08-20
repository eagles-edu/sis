ALTER TABLE "library"."LibraryAssignmentEngagement"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "proxyLoadedAt" TIMESTAMP(3),
  ADD COLUMN "firstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "uniqueOpenedAt" TIMESTAMP(3);
