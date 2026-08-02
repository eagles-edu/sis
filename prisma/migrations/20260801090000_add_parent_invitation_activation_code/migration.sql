ALTER TABLE "ParentProfileInvitation"
ADD COLUMN "activationCodeHash" TEXT,
ADD COLUMN "activatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ParentProfileInvitation_activationCodeHash_key"
ON "ParentProfileInvitation"("activationCodeHash");
