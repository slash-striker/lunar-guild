CREATE TABLE "LightsOutStats" (
    "userId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "totalMoves" INTEGER NOT NULL DEFAULT 0,
    "bestMoves" INTEGER,
    "bestTimeMs" INTEGER,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "perfectWins" INTEGER NOT NULL DEFAULT 0,
    "dailyWins" INTEGER NOT NULL DEFAULT 0,
    "challengesWon" INTEGER NOT NULL DEFAULT 0,
    "battlesWon" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LightsOutStats_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "LightsOutStats"
ADD CONSTRAINT "LightsOutStats_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("discordId")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FishingEquipment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rod" TEXT NOT NULL DEFAULT 'basic',
    "hook" TEXT NOT NULL DEFAULT 'basic',
    "bait" TEXT NOT NULL DEFAULT 'worm',
    "boat" TEXT NOT NULL DEFAULT 'none',
    "water" TEXT NOT NULL DEFAULT 'shore',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FishingEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FishingEquipment_userId_key" ON "FishingEquipment"("userId");

ALTER TABLE "FishingEquipment"
ADD CONSTRAINT "FishingEquipment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
