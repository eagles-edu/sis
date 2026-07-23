CREATE TABLE "PortalPreference" (
    "id" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "migrationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalPreference_principalType_principalId_key" ON "PortalPreference"("principalType", "principalId");
CREATE INDEX "PortalPreference_principalType_updatedAt_idx" ON "PortalPreference"("principalType", "updatedAt");

CREATE TABLE "PortalAsset" (
    "id" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "contentText" TEXT,
    "contentBytes" BYTEA,
    "width" INTEGER,
    "height" INTEGER,
    "isAnimated" BOOLEAN NOT NULL DEFAULT false,
    "sha256" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalAsset_assetKey_key" ON "PortalAsset"("assetKey");
CREATE INDEX "PortalAsset_ownerType_ownerId_idx" ON "PortalAsset"("ownerType", "ownerId");
CREATE INDEX "PortalAsset_kind_updatedAt_idx" ON "PortalAsset"("kind", "updatedAt");
