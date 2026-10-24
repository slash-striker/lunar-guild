CREATE TABLE "MastermindStats" (
  "userId" TEXT NOT NULL,
  "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
  "gamesWon" INTEGER NOT NULL DEFAULT 0,
  "totalAttempts" INTEGER NOT NULL DEFAULT 0,
  "bestAttempts" INTEGER,
  "perfectWins" INTEGER NOT NULL DEFAULT 0,
  "dailyWins" INTEGER NOT NULL DEFAULT 0,
  "speedrunWins" INTEGER NOT NULL DEFAULT 0,
  "currentStreak" INTEGER NOT NULL DEFAULT 0,
  "bestStreak" INTEGER NOT NULL DEFAULT 0,
  "totalRewards" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MastermindStats_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "MastermindStats" ADD CONSTRAINT "MastermindStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
