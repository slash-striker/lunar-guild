import prisma from '../../database/client.ts';
import { config } from '../../config/index.ts';

export class CooldownService {
  static async getUserId(discordId: string): Promise<string> {
    const user = await prisma.user.upsert({
      where: { discordId },
      update: {},
      create: {
        discordId,
        guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
      },
    });
    return user.id;
  }

  static async getCooldownDuration(command: string): Promise<number> {
    // Map command names to database field names
    const commandMap: Record<string, string> = {
      'work': 'workCooldown',
      'fish': 'fishingCooldown',
      'crime': 'crimeCooldown',
      'beg': 'begCooldown',
      'rob': 'robCooldown',
      'bankrobbery': 'bankRobberyCooldown',
      'scratchcard': 'scratchcardCooldown',
      'fivedice': 'fivediceCooldown',
      'blackjack': 'blackjackCooldown',
      'matchpairs': 'matchpairsCooldown',
      'lightsout': 'lightsoutCooldown',
      'mastermind': 'mastermindCooldown',
      'hangman': 'hangmanCooldown',
      'highlow': 'highlowCooldown',
      'rps': 'rpsCooldown',
      'tictactoe': 'tictactoeCooldown',
    };

    const dbField = commandMap[command] || 'gamesCooldown';

    try {
      const serverConfig = await prisma.serverConfig.findFirst({
        where: {
          guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
        },
      });

      console.log(`[CooldownService] Command: ${command}, Field: ${dbField}, ServerConfig:`, serverConfig ? 'Found' : 'Not found');

      if (
        serverConfig &&
        serverConfig[dbField as keyof typeof serverConfig] !== null &&
        serverConfig[dbField as keyof typeof serverConfig] !== undefined
      ) {
        const value = serverConfig[dbField as keyof typeof serverConfig] as number;
        console.log(`[CooldownService] Using database value: ${value}ms (${value / 60000} minutes)`);
        return value;
      }

      // Fallback to config
      const configValue =
      (config[dbField as keyof typeof config] as number | undefined) ??
      config.gamesCooldown;

      console.log(`[CooldownService] Using config fallback: ${configValue}ms (${configValue / 60000} minutes)`);
      return configValue;
    } catch (error) {
      console.error('Error fetching cooldown duration:', error);
      return config.gamesCooldown;
    }
  }

  static async checkCooldown(discordId: string, command: string, cooldownMs?: number): Promise<string | null> {
    console.log(`[CooldownService] checkCooldown called for command: ${command}, cooldownMs provided: ${cooldownMs}`);
    const userId = await this.getUserId(discordId);

    // If cooldownMs not provided, fetch from database
    const actualCooldownMs =
      cooldownMs !== undefined
        ? cooldownMs
        : await this.getCooldownDuration(command);

    console.log(`[CooldownService] actualCooldownMs: ${actualCooldownMs}ms (${actualCooldownMs / 60000} minutes)`);

    // If cooldown is 0, always allow (no cooldown)
    if (actualCooldownMs === 0) {
      console.log(`[CooldownService] Cooldown is 0, allowing command`);
      return null;
    }

    const cooldown = await prisma.cooldown.findUnique({
      where: {
        userId_command: {
          userId,
          command,
        },
      },
    });

    if (!cooldown) {
      return null; // No cooldown exists, can proceed
    }

    const now = new Date();
    if (now > cooldown.expiresAt) {
      return null; // Cooldown expired, can proceed
    }

    // Discord renders this as a localized relative countdown for each user.
    return `<t:${Math.ceil(cooldown.expiresAt.getTime() / 1000)}:R>`;
  }

  static async setCooldown(discordId: string, command: string, cooldownMs?: number): Promise<void> {
    console.log(`[CooldownService] setCooldown called for command: ${command}, cooldownMs provided: ${cooldownMs}`);
    const userId = await this.getUserId(discordId);

    // If cooldownMs not provided, fetch from database
    const actualCooldownMs =
      cooldownMs !== undefined
        ? cooldownMs
        : await this.getCooldownDuration(command);

    console.log(`[CooldownService] setCooldown actualCooldownMs: ${actualCooldownMs}ms (${actualCooldownMs / 60000} minutes)`);

    // If cooldown is 0, clear any existing cooldown and don't set a new one
    if (actualCooldownMs === 0) {
      console.log(`[CooldownService] Cooldown is 0, clearing existing cooldown for ${command}`);
      await this.clearCooldown(discordId, command);
      return;
    }

    const expiresAt = new Date(Date.now() + actualCooldownMs);
    console.log(`[CooldownService] Setting expiresAt to: ${expiresAt.toISOString()}`);

    await prisma.cooldown.upsert({
      where: {
        userId_command: {
          userId,
          command,
        },
      },
      update: {
        expiresAt,
      },
      create: {
        userId,
        command,
        expiresAt,
      },
    });
  }

  static async getRemainingTime(discordId: string, command: string): Promise<number> {
    const userId = await this.getUserId(discordId);
    
    const cooldown = await prisma.cooldown.findUnique({
      where: {
        userId_command: {
          userId,
          command,
        },
      },
    });

    if (!cooldown) {
      return 0;
    }

    const now = new Date();
    const remaining = cooldown.expiresAt.getTime() - now.getTime();
    return Math.max(0, remaining);
  }

  static async getExpiryTime(discordId: string, command: string): Promise<Date | null> {
    const userId = await this.getUserId(discordId);
    const cooldown = await prisma.cooldown.findUnique({
      where: {
        userId_command: {
          userId,
          command,
        },
      },
    });

    if (!cooldown || cooldown.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return cooldown.expiresAt;
  }

  static async clearCooldown(discordId: string, command: string): Promise<void> {
    const userId = await this.getUserId(discordId);
    
    // Clearing a cooldown is intentionally idempotent: concurrent requests may
    // remove the same record before this call reaches the database.
    await prisma.cooldown.deleteMany({
      where: {
        userId,
        command,
      },
    });
  }

  static async clearAllCooldowns(discordId: string): Promise<void> {
    const userId = await this.getUserId(discordId);
    
    await prisma.cooldown.deleteMany({
      where: { userId },
    });
  }

  // Clean up expired cooldowns (run periodically)
  static async cleanupExpiredCooldowns(): Promise<void> {
    await prisma.cooldown.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }
}
