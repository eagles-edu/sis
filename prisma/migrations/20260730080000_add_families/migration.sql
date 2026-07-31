CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Family_familyId_key" ON "Family"("familyId");
CREATE UNIQUE INDEX "Family_sequence_key" ON "Family"("sequence");
