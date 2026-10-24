-- Keep existing servers aligned with the configured one-hour fishing cooldown.
ALTER TABLE "ServerConfig"
ALTER COLUMN "fishingCooldown" SET DEFAULT 3600000;

UPDATE "ServerConfig"
SET "fishingCooldown" = 3600000
WHERE "fishingCooldown" = 30000;
