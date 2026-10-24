-- CreateTable
CREATE TABLE "Fish" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🐟',
    "rarity" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "catchRate" DOUBLE PRECISION NOT NULL,
    "minWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "maxWeight" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "description" TEXT,

    CONSTRAINT "Fish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaughtFish" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fishId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "value" INTEGER NOT NULL,
    "caughtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaughtFish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fish_name_key" ON "Fish"("name");

-- CreateIndex
CREATE INDEX "Fish_rarity_idx" ON "Fish"("rarity");

-- CreateIndex
CREATE INDEX "CaughtFish_userId_idx" ON "CaughtFish"("userId");

-- CreateIndex
CREATE INDEX "CaughtFish_fishId_idx" ON "CaughtFish"("fishId");

-- CreateIndex
CREATE INDEX "CaughtFish_caughtAt_idx" ON "CaughtFish"("caughtAt");

-- AddForeignKey
ALTER TABLE "CaughtFish" ADD CONSTRAINT "CaughtFish_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaughtFish" ADD CONSTRAINT "CaughtFish_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
