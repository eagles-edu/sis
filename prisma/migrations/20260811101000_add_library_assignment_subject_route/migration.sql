ALTER TABLE "library"."LibraryAssignment" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "library"."LibraryAssignment" ADD COLUMN IF NOT EXISTS "route" TEXT;
