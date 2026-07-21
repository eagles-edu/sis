ALTER TABLE "ParentPortalAccount"
  ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "ParentPortalAccount_email_key"
  ON "ParentPortalAccount"("email");
