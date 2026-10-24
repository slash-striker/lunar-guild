CREATE TABLE "FiveDiceStats" (
    "userId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "highestPayout" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "fiveOfAKind" INTEGER NOT NULL DEFAULT 0,
    "fourOfAKind" INTEGER NOT NULL DEFAULT 0,
    "fullHouses" INTEGER NOT NULL DEFAULT 0,
    "achievements" TEXT NOT NULL DEFAULT '[]',
    "dailyDateKey" TEXT,
    "dailyCompleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiveDiceStats_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "FiveDiceStats" ADD CONSTRAINT "FiveDiceStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
