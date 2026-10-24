-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomyAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wallet" INTEGER NOT NULL DEFAULT 0,
    "bank" INTEGER NOT NULL DEFAULT 0,
    "totalCreditsEarned" INTEGER NOT NULL DEFAULT 0,
    "totalCreditsSpent" INTEGER NOT NULL DEFAULT 0,
    "workEarnings" INTEGER NOT NULL DEFAULT 0,
    "workShifts" INTEGER NOT NULL DEFAULT 0,
    "highestJob" TEXT NOT NULL DEFAULT 'Unemployed',
    "currentJob" TEXT NOT NULL DEFAULT 'Unemployed',
    "careerLevel" INTEGER NOT NULL DEFAULT 0,
    "fishingCount" INTEGER NOT NULL DEFAULT 0,
    "successfulRobberies" INTEGER NOT NULL DEFAULT 0,
    "crimesCommitted" INTEGER NOT NULL DEFAULT 0,
    "begAttempts" INTEGER NOT NULL DEFAULT 0,
    "scratchcardsPurchased" INTEGER NOT NULL DEFAULT 0,
    "lotteriesWon" INTEGER NOT NULL DEFAULT 0,
    "lotteryParticipation" INTEGER NOT NULL DEFAULT 0,
    "lotteryAmountSpent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EconomyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "isTradeable" BOOLEAN NOT NULL DEFAULT true,
    "maxLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collectible" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🏆',
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collectible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCollectible" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectibleId" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCollectible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooldown" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooldown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "totalMessageCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastXPGainAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "economyChannelId" TEXT NOT NULL,
    "levelUpChannelId" TEXT NOT NULL,
    "welcomeChannelId" TEXT NOT NULL,
    "boosterChannelId" TEXT NOT NULL,
    "leaveChannelId" TEXT NOT NULL,
    "botOwnerId" TEXT NOT NULL,
    "dailyAmount" INTEGER NOT NULL DEFAULT 1000,
    "workCooldown" INTEGER NOT NULL DEFAULT 14400000,
    "workBaseSalary" INTEGER NOT NULL DEFAULT 50,
    "workMaxSalary" INTEGER NOT NULL DEFAULT 1500,
    "fishingCooldown" INTEGER NOT NULL DEFAULT 30000,
    "crimeCooldown" INTEGER NOT NULL DEFAULT 3600000,
    "begCooldown" INTEGER NOT NULL DEFAULT 60000,
    "robCooldown" INTEGER NOT NULL DEFAULT 300000,
    "scratchcardCooldown" INTEGER NOT NULL DEFAULT 60000,
    "robMinBalance" INTEGER NOT NULL DEFAULT 3000,
    "robTargetMinBalance" INTEGER NOT NULL DEFAULT 2000,
    "robSuccessChance" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "robStealPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "bankrobCost" INTEGER NOT NULL DEFAULT 5000,
    "bankrobMinPlayers" INTEGER NOT NULL DEFAULT 4,
    "bankrobTimer" INTEGER NOT NULL DEFAULT 60000,
    "bankrobStealPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "blackjackMaxBet" INTEGER NOT NULL DEFAULT 10000,
    "lotteryCost" INTEGER NOT NULL DEFAULT 2500,
    "lotteryPayoutMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "xpPerMessage" INTEGER NOT NULL DEFAULT 10,
    "xpCooldown" INTEGER NOT NULL DEFAULT 60000,
    "xpBaseRequirement" INTEGER NOT NULL DEFAULT 100,
    "xpMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lottery" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "totalPool" INTEGER NOT NULL DEFAULT 0,
    "winnerId" TEXT,
    "winnerPayout" INTEGER,
    "drawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lottery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotteryEntry" (
    "id" TEXT NOT NULL,
    "lotteryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotteryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "salary" INTEGER NOT NULL,
    "workedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE INDEX "User_discordId_guildId_idx" ON "User"("discordId", "guildId");

-- CreateIndex
CREATE UNIQUE INDEX "EconomyAccount_userId_key" ON "EconomyAccount"("userId");

-- CreateIndex
CREATE INDEX "EconomyAccount_wallet_idx" ON "EconomyAccount"("wallet");

-- CreateIndex
CREATE INDEX "EconomyAccount_bank_idx" ON "EconomyAccount"("bank");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_userId_itemId_key" ON "InventoryItem"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_name_key" ON "Item"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Collectible_name_key" ON "Collectible"("name");

-- CreateIndex
CREATE INDEX "UserCollectible_userId_idx" ON "UserCollectible"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCollectible_userId_collectibleId_key" ON "UserCollectible"("userId", "collectibleId");

-- CreateIndex
CREATE INDEX "Cooldown_userId_command_idx" ON "Cooldown"("userId", "command");

-- CreateIndex
CREATE INDEX "Cooldown_expiresAt_idx" ON "Cooldown"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cooldown_userId_command_key" ON "Cooldown"("userId", "command");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_userId_idx" ON "CurrencyTransaction"("userId");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_createdAt_idx" ON "CurrencyTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Level_userId_key" ON "Level"("userId");

-- CreateIndex
CREATE INDEX "Level_level_idx" ON "Level"("level");

-- CreateIndex
CREATE INDEX "Level_xp_idx" ON "Level"("xp");

-- CreateIndex
CREATE UNIQUE INDEX "ServerConfig_guildId_key" ON "ServerConfig"("guildId");

-- CreateIndex
CREATE INDEX "Lottery_guildId_idx" ON "Lottery"("guildId");

-- CreateIndex
CREATE INDEX "Lottery_status_idx" ON "Lottery"("status");

-- CreateIndex
CREATE INDEX "LotteryEntry_lotteryId_idx" ON "LotteryEntry"("lotteryId");

-- CreateIndex
CREATE UNIQUE INDEX "LotteryEntry_lotteryId_userId_key" ON "LotteryEntry"("lotteryId", "userId");

-- CreateIndex
CREATE INDEX "GameSession_userId_idx" ON "GameSession"("userId");

-- CreateIndex
CREATE INDEX "GameSession_gameType_idx" ON "GameSession"("gameType");

-- CreateIndex
CREATE INDEX "GameSession_state_idx" ON "GameSession"("state");

-- CreateIndex
CREATE INDEX "WorkHistory_userId_idx" ON "WorkHistory"("userId");

-- CreateIndex
CREATE INDEX "WorkHistory_workedAt_idx" ON "WorkHistory"("workedAt");

-- AddForeignKey
ALTER TABLE "EconomyAccount" ADD CONSTRAINT "EconomyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCollectible" ADD CONSTRAINT "UserCollectible_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCollectible" ADD CONSTRAINT "UserCollectible_collectibleId_fkey" FOREIGN KEY ("collectibleId") REFERENCES "Collectible"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cooldown" ADD CONSTRAINT "Cooldown_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyTransaction" ADD CONSTRAINT "CurrencyTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotteryEntry" ADD CONSTRAINT "LotteryEntry_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES "Lottery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotteryEntry" ADD CONSTRAINT "LotteryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkHistory" ADD CONSTRAINT "WorkHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
