CREATE TABLE "WeeklyEvent" (
    "dateKey" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drawnAt" TIMESTAMP(3),
    "winnerId" TEXT,
    CONSTRAINT "WeeklyEvent_pkey" PRIMARY KEY ("dateKey")
);

CREATE TABLE "WeeklyEventEntry" (
    "id" TEXT NOT NULL,
    "eventDate" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyEventEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeeklyEventEntry_eventDate_userId_key" ON "WeeklyEventEntry"("eventDate", "userId");
CREATE INDEX "WeeklyEvent_guildId_openedAt_idx" ON "WeeklyEvent"("guildId", "openedAt");
CREATE INDEX "WeeklyEventEntry_userId_idx" ON "WeeklyEventEntry"("userId");
ALTER TABLE "WeeklyEventEntry" ADD CONSTRAINT "WeeklyEventEntry_eventDate_fkey"
  FOREIGN KEY ("eventDate") REFERENCES "WeeklyEvent"("dateKey") ON DELETE CASCADE ON UPDATE CASCADE;
