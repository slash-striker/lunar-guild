import prisma from '../../database/client.ts';
import { config } from '../../config/index.ts';
import type { Prisma } from '@prisma/client';
import type { Guild } from 'discord.js';

export class EconomyService {
  static async ensureUserAccount(discordId: string) {
    // First ensure user exists
    const user = await prisma.user.upsert({
      where: { discordId },
      update: {},
      create: {
        discordId,
        guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
      },
    });

    return await prisma.economyAccount.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        wallet: 0,
        bank: 0,
        totalCreditsEarned: 0,
        totalCreditsSpent: 0,
        workEarnings: 0,
        workShifts: 0,
        highestJob: 'Unemployed',
        currentJob: 'Unemployed',
        careerLevel: 0,
      },
    });
  }

  static async getBalance(discordId: string) {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: { economyAccount: true },
    });

    if (!user || !user.economyAccount) {
      return await this.ensureUserAccount(discordId);
    }

    return user.economyAccount;
  }

  static async isDoubleCoinDay(): Promise<boolean> {
    const config = await prisma.serverConfig.findFirst({
      where: { guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844' }
    });

    if (!config || !config.doubleCoinDayEnabled) {
      return false;
    }

    const now = new Date();
    const dayOfMonth = now.getDate();
    return dayOfMonth <= config.doubleCoinDayDays;
  }

  static async addCredits(
    discordId: string,
    amount: number,
    reason: string,
    source: string,
    applyMultipliers = true,
  ): Promise<void> {
    if (amount < 0) {
      throw new Error('Amount must be non-negative');
    }

    const isDoubleCoinDay = await this.isDoubleCoinDay();
    const finalAmount = applyMultipliers && isDoubleCoinDay ? amount * 2 : amount;
    const finalReason = isDoubleCoinDay ? `${reason} (Double Coin Day!)` : reason;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const account = await this.ensureUserAccount(discordId);

      await tx.economyAccount.update({
        where: { userId: account.userId },
        data: {
          wallet: { increment: finalAmount },
          totalCreditsEarned: { increment: finalAmount },
        },
      });

      await tx.currencyTransaction.create({
        data: {
          userId: account.userId,
          amount: finalAmount,
          type: 'GAIN',
          reason: finalReason,
          source,
          balanceAfter: account.wallet + finalAmount,
        },
      });
    });
  }

  static async removeCredits(discordId: string, amount: number, reason: string, source: string): Promise<void> {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const account = await this.ensureUserAccount(discordId);
      
      if (account.wallet < amount) {
        throw new Error('Insufficient funds');
      }

      await tx.economyAccount.update({
        where: { userId: account.userId },
        data: {
          wallet: { decrement: amount },
          totalCreditsSpent: { increment: amount },
        },
      });

      await tx.currencyTransaction.create({
        data: {
          userId: account.userId,
          amount: -amount,
          type: 'LOSS',
          reason,
          source,
          balanceAfter: account.wallet - amount,
        },
      });
    });
  }

  static async removeCreditsFromBalances(
    discordId: string,
    amount: number,
    balanceSource: 'wallet' | 'bank' | 'both',
    reason: string,
    source: string,
  ): Promise<{ wallet: number; bank: number }> {
    if (amount <= 0) throw new Error('Amount must be positive');

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const account = await this.ensureUserAccount(discordId);
      const available = balanceSource === 'wallet'
        ? account.wallet
        : balanceSource === 'bank'
          ? account.bank
          : account.wallet + account.bank;

      if (available < amount) throw new Error(`Insufficient ${balanceSource} funds`);

      const walletAmount = balanceSource === 'bank' ? 0 : Math.min(account.wallet, amount);
      const bankAmount = amount - walletAmount;
      await tx.economyAccount.update({
        where: { userId: account.userId },
        data: {
          wallet: { decrement: walletAmount },
          bank: { decrement: bankAmount },
          totalCreditsSpent: { increment: amount },
        },
      });
      await tx.currencyTransaction.create({
        data: {
          userId: account.userId,
          amount: -amount,
          type: 'LOSS',
          reason,
          source,
          balanceAfter: account.wallet + account.bank - amount,
        },
      });
      return { wallet: walletAmount, bank: bankAmount };
    });
  }

  static async transferCredits(fromDiscordId: string, toDiscordId: string, amount: number, reason: string): Promise<void> {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (fromDiscordId === toDiscordId) {
      throw new Error('Cannot transfer to yourself');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const fromAccount = await this.ensureUserAccount(fromDiscordId);
      
      if (fromAccount.wallet < amount) {
        throw new Error('Insufficient funds');
      }

      const toAccount = await this.ensureUserAccount(toDiscordId);

      // Remove from sender
      await tx.economyAccount.update({
        where: { userId: fromAccount.userId },
        data: {
          wallet: { decrement: amount },
          totalCreditsSpent: { increment: amount },
        },
      });

      // Add to recipient
      await tx.economyAccount.update({
        where: { userId: toAccount.userId },
        data: {
          wallet: { increment: amount },
          totalCreditsEarned: { increment: amount },
        },
      });

      // Log transactions
      await tx.currencyTransaction.create({
        data: {
          userId: fromAccount.userId,
          amount: -amount,
          type: 'TRANSFER_OUT',
          reason,
          source: 'TRANSFER',
          balanceAfter: fromAccount.wallet - amount,
        },
      });

      await tx.currencyTransaction.create({
        data: {
          userId: toAccount.userId,
          amount,
          type: 'TRANSFER_IN',
          reason,
          source: 'TRANSFER',
          balanceAfter: toAccount.wallet + amount,
        },
      });
    });
  }

  static async transferCreditsFromBalances(
    fromDiscordId: string,
    toDiscordId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    if (amount <= 0) throw new Error('Amount must be positive');
    if (fromDiscordId === toDiscordId) throw new Error('Cannot transfer to yourself');

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const fromAccount = await this.ensureUserAccount(fromDiscordId);
      const toAccount = await this.ensureUserAccount(toDiscordId);
      if (fromAccount.wallet + fromAccount.bank < amount) {
        throw new Error('Insufficient wallet and bank funds');
      }

      const walletAmount = Math.min(fromAccount.wallet, amount);
      const bankAmount = amount - walletAmount;
      await tx.economyAccount.update({
        where: { userId: fromAccount.userId },
        data: {
          wallet: { decrement: walletAmount },
          bank: { decrement: bankAmount },
          totalCreditsSpent: { increment: amount },
        },
      });
      await tx.economyAccount.update({
        where: { userId: toAccount.userId },
        data: {
          wallet: { increment: amount },
          totalCreditsEarned: { increment: amount },
        },
      });
      await tx.currencyTransaction.create({
        data: {
          userId: fromAccount.userId,
          amount: -amount,
          type: 'TRANSFER_OUT',
          reason,
          source: 'TRANSFER',
          balanceAfter: fromAccount.wallet + fromAccount.bank - amount,
        },
      });
      await tx.currencyTransaction.create({
        data: {
          userId: toAccount.userId,
          amount,
          type: 'TRANSFER_IN',
          reason,
          source: 'TRANSFER',
          balanceAfter: toAccount.wallet + toAccount.bank + amount,
        },
      });
    });
  }

  static async depositToBank(discordId: string, amount: number): Promise<void> {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const account = await this.ensureUserAccount(discordId);
      
      if (account.wallet < amount) {
        throw new Error('Insufficient wallet funds');
      }

      await tx.economyAccount.update({
        where: { userId: account.userId },
        data: {
          wallet: { decrement: amount },
          bank: { increment: amount },
        },
      });

      await tx.currencyTransaction.create({
        data: {
          userId: account.userId,
          amount: -amount,
          type: 'BANK_DEPOSIT',
          reason: 'Bank deposit',
          source: 'BANK',
          balanceAfter: account.wallet - amount,
        },
      });
    });
  }

  static async withdrawFromBank(discordId: string, amount: number): Promise<void> {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const account = await this.ensureUserAccount(discordId);
      
      if (account.bank < amount) {
        throw new Error('Insufficient bank funds');
      }

      await tx.economyAccount.update({
        where: { userId: account.userId },
        data: {
          wallet: { increment: amount },
          bank: { decrement: amount },
        },
      });

      await tx.currencyTransaction.create({
        data: {
          userId: account.userId,
          amount,
          type: 'BANK_WITHDRAW',
          reason: 'Bank withdrawal',
          source: 'BANK',
          balanceAfter: account.wallet + amount,
        },
      });
    });
  }

  static async getNetWorth(discordId: string): Promise<number> {
    const account = await this.getBalance(discordId);
    return account.wallet + account.bank;
  }

  static async getTransactionHistory(discordId: string, limit: number = 20, offset: number = 0) {
    const user = await prisma.user.findUnique({
      where: { discordId },
    });

    if (!user) return [];

    return await prisma.currencyTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  static async getLeaderboard(type: 'wallet' | 'bank' | 'networth', limit: number = 10, offset: number = 0, excludeUserId?: string) {
    const accounts = await prisma.economyAccount.findMany({
      where: excludeUserId
        ? { user: { discordId: { not: excludeUserId } } }
        : undefined,
      select: {
        wallet: true,
        bank: true,
        user: {
          select: { discordId: true },
        },
      },
      orderBy: type === 'wallet' ? { wallet: 'desc' } : type === 'bank' ? { bank: 'desc' } : undefined,
    });

    if (type === 'networth') {
      accounts.sort((a: any, b: any) => (b.wallet + b.bank) - (a.wallet + a.bank));
    }

    return accounts.slice(offset, offset + limit);
  }

  static async syncCreditsLeaderRole(
    guild: Guild,
    type: 'wallet' | 'bank' | 'networth',
    excludeUserId?: string,
  ): Promise<void> {
    const role = await guild.roles.fetch(config.creditsLeaderRoleId);
    const botMember = await guild.members.fetchMe();
    if (!role) {
      console.warn(`Credits leader role ${config.creditsLeaderRoleId} was not found in guild ${guild.id}.`);
      return;
    }
    if (role.managed) {
      console.warn(`Credits leader role ${role.id} is managed by an integration and cannot be assigned manually.`);
      return;
    }
    if (!botMember.permissions.has('ManageRoles')) {
      console.warn('Cannot synchronize credits leader role because the bot is missing Manage Roles permission.');
      return;
    }
    if (role.position >= botMember.roles.highest.position) {
      console.warn(
        `Cannot synchronize credits leader role: role position ${role.position} is not below ` +
        `the bot's highest role position ${botMember.roles.highest.position}.`,
      );
      return;
    }

    const leaders = await this.getLeaderboard(type, 1, 0, excludeUserId);
    const leaderId = leaders[0]?.user.discordId;
    const members = await guild.members.fetch();
    const holders = members.filter(member => member.roles.cache.has(role.id));
    for (const member of holders.values()) {
      if (member.id === leaderId) continue;
      try {
        await member.roles.remove(role, 'Credits leaderboard changed');
      } catch (error) {
        console.error(`Could not remove credits leader role from ${member.id}:`, error);
      }
    }

    if (leaderId) {
      const leader = await guild.members.fetch(leaderId).catch(() => null);
      if (!leader) {
        console.warn(`Current credits leader ${leaderId} is not a member of ${guild.id}.`);
        return;
      }
      if (leader.roles.highest.position >= botMember.roles.highest.position) {
        console.warn(`Cannot assign credits leader role to ${leaderId}; their highest role is not below the bot.`);
        return;
      }
      if (!leader.roles.cache.has(role.id)) {
        try {
          await leader.roles.add(role, 'Current #1 credits leaderboard holder');
        } catch (error) {
          console.error(`Could not assign credits leader role to ${leaderId}:`, error);
        }
      }
    }
  }

  static async applyBankInterest(discordId: string) {
    const user = await prisma.user.findUnique({
      where: { discordId },
    });

    if (!user) return 0;

    const account = await this.ensureUserAccount(discordId);
    
    if (account.bank === 0) return 0;

    const serverConfig = await prisma.serverConfig.findFirst({
      where: { guildId: user.guildId },
    });
    const interestRate = serverConfig?.bankInterestRate || 0.05;

    const now = new Date();
    const lastInterest = new Date(account.lastInterestDate);
    const daysSinceLastInterest = Math.floor((now.getTime() - lastInterest.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceLastInterest < 1) return 0;

    const interest = Math.floor(account.bank * interestRate * daysSinceLastInterest);
    
    if (interest > 0) {
      await prisma.economyAccount.update({
        where: { userId: account.userId },
        data: {
          bank: { increment: interest },
          lastInterestDate: now,
        },
      });
    }

    return interest;
  }

  static async applyAllBankInterest() {
    const accounts = await prisma.economyAccount.findMany({
      where: { bank: { gt: 0 } },
      include: { user: true },
    });

    const now = new Date();
    let totalInterest = 0;

    for (const account of accounts) {
      const serverConfig = await prisma.serverConfig.findFirst({
        where: { guildId: account.user.guildId },
      });
      const interestRate = serverConfig?.bankInterestRate || 0.05;

      const lastInterest = new Date(account.lastInterestDate);
      const daysSinceLastInterest = Math.floor((now.getTime() - lastInterest.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSinceLastInterest >= 1) {
        const interest = Math.floor(account.bank * interestRate * daysSinceLastInterest);
        
        if (interest > 0) {
          await prisma.economyAccount.update({
            where: { userId: account.userId },
            data: {
              bank: { increment: interest },
              lastInterestDate: now,
            },
          });
          totalInterest += interest;
        }
      }
    }

    return totalInterest;
  }
}
