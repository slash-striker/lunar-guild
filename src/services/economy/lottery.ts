import { EconomyService } from './index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export class LotteryService {
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

  static async buyTicket(discordId: string) {
    const userId = await this.getUserId(discordId);

    // Get (or create) the active lottery, drawing any expired one first
    const lottery = await this.resolveActiveLotteryForPurchase();

    // Check if user already has a ticket
    const existingEntry = await prisma.lotteryEntry.findFirst({
      where: {
        lotteryId: lottery.id,
        userId,
      },
    });

    if (existingEntry) {
      throw new Error('You already have a ticket for this lottery!');
    }

    // Create entry
    await prisma.lotteryEntry.create({
      data: {
        lotteryId: lottery.id,
        userId,
        amount: config.lotteryCost,
      },
    });

    // Update user stats
    await prisma.economyAccount.update({
      where: { userId },
      data: {
        lotteryParticipation: { increment: 1 },
        lotteryAmountSpent: { increment: config.lotteryCost },
      },
    });

    return lottery;
  }

  static async drawLottery(lotteryId: string) {
    const lottery = await prisma.lottery.findUnique({
      where: { id: lotteryId },
      include: {
        entries: true,
      },
    });

    if (!lottery || lottery.status !== 'ACTIVE') {
      throw new Error('Invalid lottery');
    }

    // Calculate prize pool
    const totalTickets = lottery.entries.length;
    const prizePool = totalTickets * config.lotteryCost * config.lotteryPayoutMultiplier;

    if (totalTickets === 0) {
      // No participants, close lottery
      await prisma.lottery.update({
        where: { id: lotteryId },
        data: {
          status: 'COMPLETED',
          winnerId: null,
          totalPool: 0,
        },
      });
      return null;
    }

    // Pick winner
    const winnerIndex = Math.floor(Math.random() * totalTickets);
    const winner = lottery.entries[winnerIndex];

    // Award prize
    await EconomyService.addCredits(winner.userId, prizePool, 'Lottery win', 'LOTTERY');

    // Update winner stats
    await prisma.economyAccount.update({
      where: { userId: winner.userId },
      data: { lotteriesWon: { increment: 1 } },
    });

    // Update lottery
    await prisma.lottery.update({
      where: { id: lotteryId },
      data: {
        status: 'COMPLETED',
        winnerId: winner.userId,
        totalPool: prizePool,
      },
    });

    return {
      winnerId: winner.userId,
      prizePool,
      totalTickets,
    };
  }

  static async getActiveLottery() {
    // Draw any lottery whose deadline passed so stale lotteries never linger
    await this.drawDueLotteries();

    return await prisma.lottery.findFirst({
      where: { status: 'ACTIVE' },
      include: {
        entries: true,
      },
    });
  }

  /**
   * Draw every lottery whose deadline has passed. This acts as a catch-up
   * mechanism so lotteries still close even if the bot was offline at the
   * scheduled draw time.
   */
  static async drawDueLotteries(): Promise<Array<{ winnerId: string | null; prizePool: number; totalTickets: number } | null>> {
    const dueLotteries = await prisma.lottery.findMany({
      where: {
        status: 'ACTIVE',
        drawnAt: { lte: new Date() },
      },
    });

    const results: Array<{ winnerId: string | null; prizePool: number; totalTickets: number } | null> = [];

    for (const lottery of dueLotteries) {
      try {
        results.push(await this.drawLottery(lottery.id));
      } catch (error) {
        console.error(`Failed to draw lottery ${lottery.id}:`, error);
        results.push(null);
      }
    }

    return results;
  }

  /**
   * Lazily resolve the active lottery for ticket purchases: if the active
   * lottery is past its deadline, draw it first and start a fresh one.
   */
  private static async resolveActiveLotteryForPurchase() {
    let lottery = await prisma.lottery.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!lottery) {
      return await this.createNewLottery();
    }

    if (lottery.drawnAt && lottery.drawnAt < new Date()) {
      await this.drawLottery(lottery.id);
      lottery = await this.createNewLottery();
    }

    return lottery;
  }

  private static async createNewLottery() {
    // Calculate next Sunday 12PM
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()) % 7);
    nextSunday.setHours(12, 0, 0, 0);
    if (nextSunday <= now) {
      nextSunday.setDate(nextSunday.getDate() + 7);
    }

    return await prisma.lottery.create({
      data: {
        status: 'ACTIVE',
        totalPool: 0,
        guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
        drawnAt: nextSunday,
      },
    });
  }

  static async getLotteryHistory(limit: number = 10) {
    return await prisma.lottery.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { drawnAt: 'desc' },
      take: limit,
    });
  }
}
