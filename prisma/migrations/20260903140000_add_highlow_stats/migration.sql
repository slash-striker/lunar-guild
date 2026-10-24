CREATE TABLE "HighLowStats" (
    "userId" TEXT NOT NULL,
    "roundsPlayed" INTEGER NOT NULL DEFAULT 0,
    "roundsWon" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "totalWinnings" INTEGER NOT NULL DEFAULT 0,
    "highestPayout" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "luckyRounds" INTEGER NOT NULL DEFAULT 0,
    "mysteryMultipliers" INTEGER NOT NULL DEFAULT 0,
    "twoXMultipliers" INTEGER NOT NULL DEFAULT 0,
    "pvpGames" INTEGER NOT NULL DEFAULT 0,
    "pvpWins" INTEGER NOT NULL DEFAULT 0,
    "progressionXP" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "achievements" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HighLowStats_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "HighLowStats" ADD CONSTRAINT "HighLowStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
