-- AlterTable
ALTER TABLE "EconomyAccount" ADD COLUMN     "blackjackRulesAgreed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServerConfig" ADD COLUMN     "doubleCoinDayDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "doubleCoinDayEnabled" BOOLEAN NOT NULL DEFAULT true;
