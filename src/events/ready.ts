import { Events, ActivityType } from 'discord.js';
import prisma from '../database/client.ts';
import { config } from '../config/index.ts';
import { EconomyService } from '../services/economy/index.ts';
import { CooldownService } from '../services/cooldowns/index.ts';
import { LotteryService } from '../services/economy/lottery.ts';
import { scheduleGiveaways } from '../commands/admin/giveaway.ts';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client: any) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guild(s)`);

    // Initialize server config if it doesn't exist
    try {
      await prisma.serverConfig.upsert({
        where: { guildId: config.guildId },
        update: {},
        create: {
          guildId: config.guildId,
          economyChannelId: config.economyChannelId,
          levelUpChannelId: config.levelUpChannelId,
          welcomeChannelId: config.welcomeChannelId,
          boosterChannelId: config.boosterChannelId,
          leaveChannelId: config.leaveChannelId,
          botOwnerId: config.botOwnerIds[0],
          bankInterestRate: 0.05,
        },
      });
      console.log('✅ Server config initialized');
    } catch (error) {
      console.error('❌ Error initializing server config:', error);
    }

    // Close any lottery that reached its deadline while the bot was offline,
    // then schedule the next check shortly after the next deadline.
    const checkDueLotteries = async () => {
      try {
        const drawn = await LotteryService.drawDueLotteries();
        for (const result of drawn) {
          if (result?.winnerId) {
            console.log(`🎰 Lottery drawn: winner ${result.winnerId} won ${result.prizePool.toLocaleString()} credits (${result.totalTickets} tickets)`);
          } else if (result) {
            console.log('🎰 Lottery closed with no participants');
          }
        }
      } catch (error) {
        console.error('Lottery draw check failed:', error);
      }
    };

    await checkDueLotteries();
    setInterval(() => {
      checkDueLotteries();
    }, 60 * 1000);

    // Resume giveaways that were pending when the bot last stopped,
    // including any whose deadline passed while it was offline.
    await scheduleGiveaways(client);

    // Set bot activity
    client.user.setActivity('mk48 ⛴️ ⚓️', { type: ActivityType.Playing });
    const allowanceCooldown = await CooldownService.checkCooldown(client.user.id, 'bot_daily_allowance');
    if (allowanceCooldown === null) {
      await EconomyService.addCredits(
        client.user.id,
        config.botDailyAllowance,
        'Daily bot allowance',
        'BOT_ALLOWANCE',
        false,
      );
      await CooldownService.setCooldown(client.user.id, 'bot_daily_allowance', 24 * 60 * 60 * 1000);
      console.log(`✅ Added ${config.botDailyAllowance.toLocaleString()} credits to the bot allowance account`);
    }
    const depositAtDayEnd = async () => {
      const depositCooldown = await CooldownService.checkCooldown(client.user.id, 'bot_daily_bank_deposit');
      if (depositCooldown !== null) return;

      const account = await EconomyService.getBalance(client.user.id);
      const depositAmount = Math.floor(account.wallet * 0.8);
      if (depositAmount > 0) {
        await EconomyService.depositToBank(client.user.id, depositAmount);
        console.log(`✅ Deposited ${depositAmount.toLocaleString()} bot credits into the bank`);
      }
      await CooldownService.setCooldown(
        client.user.id,
        'bot_daily_bank_deposit',
        24 * 60 * 60 * 1000,
      );
    };

    const now = new Date();
    const nextUtcDay = new Date(now);
    nextUtcDay.setUTCHours(24, 0, 0, 0);
    setTimeout(() => {
      depositAtDayEnd().catch((error) => console.error('Bot bank deposit failed:', error));
      setInterval(() => {
        depositAtDayEnd().catch((error) => console.error('Bot bank deposit failed:', error));
      }, 24 * 60 * 60 * 1000);
    }, nextUtcDay.getTime() - now.getTime());
  },
};
