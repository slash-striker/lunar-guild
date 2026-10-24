CREATE TABLE "LightsOutDailyWin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LightsOutDailyWin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LightsOutDailyWin_userId_dateKey_key"
ON "LightsOutDailyWin"("userId", "dateKey");

CREATE INDEX "LightsOutDailyWin_dateKey_idx" ON "LightsOutDailyWin"("dateKey");

ALTER TABLE "LightsOutDailyWin"
ADD CONSTRAINT "LightsOutDailyWin_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("discordId")
ON DELETE CASCADE ON UPDATE CASCADE;
