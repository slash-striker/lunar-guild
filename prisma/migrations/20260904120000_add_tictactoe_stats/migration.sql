CREATE TABLE "TicTacToeStats" (
    "userId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicTacToeStats_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE "TicTacToeGameHistory" (
    "id" TEXT NOT NULL,
    "player1Id" TEXT NOT NULL,
    "player2Id" TEXT NOT NULL,
    "winnerId" TEXT,
    "result" TEXT NOT NULL,
    "moves" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicTacToeGameHistory_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TicTacToeStats" ADD CONSTRAINT "TicTacToeStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicTacToeGameHistory" ADD CONSTRAINT "TicTacToeGameHistory_player1Id_fkey"
  FOREIGN KEY ("player1Id") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicTacToeGameHistory" ADD CONSTRAINT "TicTacToeGameHistory_player2Id_fkey"
  FOREIGN KEY ("player2Id") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
