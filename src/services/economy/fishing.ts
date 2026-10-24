import { EconomyService } from './index.ts';
import { FishingTycoonService } from './fishing-tycoon.ts';
import { FISH_DATA, FISH_PAYOUT_CONFIG } from '../../config/fish.ts';
import prisma from '../../database/client.ts';

export class FishingService {
  static async fish(discordId: string, guildId: string) {
    const account = await EconomyService.getBalance(discordId);
    
    // Ensure fish data exists in database
    await this.ensureFishData();
    
    // Roll for catch
    const roll = Math.random();
    let cumulativeChance = 0;
    let caughtFish = FISH_DATA[0];
    
    for (const fish of FISH_DATA) {
      cumulativeChance += fish.catchRate;
      if (roll < cumulativeChance) {
        caughtFish = fish;
        break;
      }
    }
    
    // Calculate weight and value
    const weight = this.randomWeight(caughtFish.minWeight, caughtFish.maxWeight);
    const weightMultiplier = weight / ((caughtFish.minWeight + caughtFish.maxWeight) / 2);
    const payoutConfig = FISH_PAYOUT_CONFIG[caughtFish.rarity as keyof typeof FISH_PAYOUT_CONFIG];
    const value = Math.max(
      payoutConfig.minimum,
      Math.floor(caughtFish.value * weightMultiplier * payoutConfig.multiplier),
    );
    
    // Get fish from database
    const fishRecord = await prisma.fish.findUnique({
      where: { name: caughtFish.name },
    });
    
    if (!fishRecord) {
      throw new Error(`Fish ${caughtFish.name} not found in database`);
    }
    
    // Get user
    const user = await prisma.user.findFirst({
      where: { discordId, guildId },
    });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Record caught fish
    await prisma.caughtFish.create({
      data: {
        userId: user.id,
        fishId: fishRecord.id,
        weight,
        value,
      },
    });
    
    // Update fishing count
    await prisma.economyAccount.update({
      where: { userId: account.userId },
      data: {
        fishingCount: { increment: 1 },
      },
    });
    
    return {
      name: caughtFish.name,
      emoji: caughtFish.emoji,
      rarity: caughtFish.rarity,
      weight,
      value,
      description: caughtFish.description,
    };
  }

  static async ensureFishData() {
    const existingFish = await prisma.fish.findMany();
    
    if (existingFish.length === FISH_DATA.length) {
      return; // All fish already exist
    }
    
    for (const fish of FISH_DATA) {
      await prisma.fish.upsert({
        where: { name: fish.name },
        update: {},
        create: {
          name: fish.name,
          emoji: fish.emoji,
          rarity: fish.rarity,
          value: fish.value,
          catchRate: fish.catchRate,
          minWeight: fish.minWeight,
          maxWeight: fish.maxWeight,
          description: fish.description,
        },
      });
    }
  }

  static randomWeight(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  static async getCaughtFish(discordId: string, guildId: string, limit: number = 10) {
    const user = await prisma.user.findFirst({
      where: { discordId, guildId },
      include: {
        caughtFish: {
          include: { fish: true },
          orderBy: { caughtAt: 'desc' },
          take: limit,
        },
      },
    });
    
    return user?.caughtFish || [];
  }

  static async sellFish(discordId: string, guildId: string, fishId: string) {
    const user = await prisma.user.findFirst({
      where: { discordId, guildId },
      include: {
        caughtFish: {
          where: { id: fishId },
          include: { fish: true },
        },
      },
    });
    
    if (!user || user.caughtFish.length === 0) {
      throw new Error('Fish not found');
    }
    
    const caughtFish = user.caughtFish[0];
    
    // Add credits
    await EconomyService.addCredits(discordId, caughtFish.value, `Sold ${caughtFish.fish.name}`, 'FISHING');
    
    // Delete the caught fish record
    await prisma.caughtFish.delete({
      where: { id: fishId },
    });
    
    return {
      name: caughtFish.fish.name,
      emoji: caughtFish.fish.emoji,
      value: caughtFish.value,
    };
  }

  static async sellAllFish(discordId: string, guildId: string) {
    const user = await prisma.user.findFirst({
      where: { discordId, guildId },
      include: {
        caughtFish: {
          include: { fish: true },
        },
      },
    });
    
    if (!user || user.caughtFish.length === 0) {
      return { totalValue: 0, count: 0 };
    }
    
    const totalValue = user.caughtFish.reduce((sum: number, fish: any) => sum + fish.value, 0);
    
    // Add credits
    await EconomyService.addCredits(discordId, totalValue, 'Sold all fish', 'FISHING');
    
    // Delete all caught fish
    await prisma.caughtFish.deleteMany({
      where: { userId: user.id },
    });
    
    return {
      totalValue,
      count: user.caughtFish.length,
      fish: user.caughtFish.map((caughtFish: any) => ({
        name: caughtFish.fish.name,
        emoji: caughtFish.fish.emoji,
        value: caughtFish.value,
      })),
    };
  }

  static async getFishingStats(discordId: string, guildId: string) {
    const user = await prisma.user.findFirst({
      where: { discordId, guildId },
      include: {
        economyAccount: true,
        caughtFish: true,
      },
    });

    if (!user) {
      return { fishingCount: 0, totalCaught: 0, totalValue: 0 };
    }

    const totalCaught = user.caughtFish.length;
    const totalValue = user.caughtFish.reduce((sum: number, fish: any) => sum + fish.value, 0);

    return {
      fishingCount: user.economyAccount?.fishingCount || 0,
      totalCaught,
      totalValue,
    };
  }
}
