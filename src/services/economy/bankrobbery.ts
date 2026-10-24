import { EconomyService } from './index.ts';
import { InventoryService } from '../inventory/index.ts';
import { CooldownService } from '../cooldowns/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export class BankRobberyService {
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

  static async startBankRobbery(initiatorDiscordId: string) {
    const initiatorId = await this.getUserId(initiatorDiscordId);
    
    // Check if a bank robbery is already in progress
    const activeRobbery = await prisma.gameSession.findFirst({
      where: {
        gameType: 'BANK_ROBBERY',
        state: 'active',
      },
    });

    if (activeRobbery) {
      throw new Error('A bank robbery is already in progress!');
    }

    // Check cooldown
    const cooldown = await CooldownService.checkCooldown(initiatorDiscordId, 'bank_robbery', config.bankRobberyCooldown);
    if (cooldown !== null) {
      throw new Error(`Bank robbery cooldown active: ${cooldown} remaining`);
    }

    // Create bank robbery session
    const session = await prisma.gameSession.create({
      data: {
        userId: initiatorId,
        gameType: 'BANK_ROBBERY',
        state: 'active',
        payload: JSON.stringify({
          startTime: new Date().toISOString(),
          participants: [initiatorDiscordId],
          phase: 'GATHERING',
        }),
      },
    });

    // Set cooldown
    await CooldownService.setCooldown(initiatorDiscordId, 'bank_robbery', config.bankRobberyCooldown);

    return session;
  }

  static async joinBankRobbery(userDiscordId: string, sessionId: string) {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.gameType !== 'BANK_ROBBERY' || session.state !== 'active') {
      throw new Error('Invalid or inactive bank robbery session');
    }

    const data = JSON.parse(session.payload) as { phase: string; participants: string[] };
    
    if (data.phase !== 'GATHERING') {
      throw new Error('Bank robbery is no longer accepting participants');
    }

    if (data.participants.includes(userDiscordId)) {
      throw new Error('You are already participating in this bank robbery');
    }

    if (data.participants.length >= config.bankRobberyMaxParticipants) {
      throw new Error('Bank robbery is full');
    }

    data.participants.push(userDiscordId);
    
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { payload: JSON.stringify(data) },
    });

    return data.participants.length;
  }

  static async executeBankRobbery(sessionId: string) {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    const data = JSON.parse(session.payload) as { participants: string[]; [key: string]: unknown };
    const participants = data.participants as string[];

    // Calculate success chance based on participants
    const successChance = Math.min(
      config.bankRobberyBaseSuccessChance + (participants.length * 0.05),
      0.9 // Max 90% success rate
    );

    const roll = Math.random();
    const success = roll < successChance;

    if (success) {
      // Calculate reward
      const baseReward = config.bankRobberyBaseReward;
      const participantBonus = participants.length * config.bankRobberyParticipantBonus;
      const totalReward = baseReward + participantBonus;
      const rewardPerPerson = Math.floor(totalReward / participants.length);

      // Distribute rewards
      for (const participantDiscordId of participants) {
        await EconomyService.addCredits(participantDiscordId, rewardPerPerson, 'Bank robbery reward', 'BANK_ROBBERY');
      }

      // Update session
      await prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          state: 'completed',
          payload: JSON.stringify({
            ...data,
            phase: 'COMPLETED',
            success: true,
            rewardPerPerson,
            completedAt: new Date().toISOString(),
          }),
        },
      });

      return {
        success: true,
        rewardPerPerson,
        participants: participants.length,
      };
    } else {
      // Calculate penalty
      const penalty = config.bankRobberyPenalty;

      // Apply penalties
      for (const participantDiscordId of participants) {
        try {
          await EconomyService.removeCredits(participantDiscordId, penalty, 'Bank robbery penalty', 'BANK_ROBBERY');
        } catch {
          // User doesn't have enough credits, skip
        }
      }

      // Update session
      await prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          state: 'completed',
          payload: JSON.stringify({
            ...data,
            phase: 'FAILED',
            success: false,
            penalty,
            completedAt: new Date().toISOString(),
          }),
        },
      });

      return {
        success: false,
        penalty,
        participants: participants.length,
      };
    }
  }

  static async getActiveBankRobbery() {
    return await prisma.gameSession.findFirst({
      where: {
        gameType: 'BANK_ROBBERY',
        state: 'active',
      },
    });
  }

  static async cancelBankRobbery(sessionId: string) {
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        state: 'completed',
      },
    });
  }
}
