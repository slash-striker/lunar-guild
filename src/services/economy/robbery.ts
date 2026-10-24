import { EconomyService } from './index.ts';
import { InventoryService } from '../inventory/index.ts';
import { config, isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export class RobberyService {
  static async robUser(robberDiscordId: string, targetDiscordId: string, hasLuckyDice: boolean = false) {
    // Check balances
    const robberAccount = await EconomyService.getBalance(robberDiscordId);
    const targetAccount = await EconomyService.getBalance(targetDiscordId);

    if (robberAccount.wallet < config.robMinBalance) {
      throw new Error(`You need at least ${config.robMinBalance.toLocaleString()} credits to rob someone.`);
    }

    const targetHoldings = targetAccount.wallet + targetAccount.bank;
    if (targetHoldings < config.robTargetMinBalance) {
      throw new Error(`Target must have at least ${config.robTargetMinBalance.toLocaleString()} credits to be robbed.`);
    }

    // Calculate success chance
    let successChance = config.robSuccessChance;
    
    // Check for lucky dice
    if (hasLuckyDice) {
      successChance += config.luckyDiceBonus;
    }

    // Check for watchdogs
    const watchdogCount = await InventoryService.getItemQuantity(targetDiscordId, 'watchdog');
    if (watchdogCount > 0) {
      successChance -= (watchdogCount * config.watchdogProtection);
    }

    // Roll for success
    const roll = Math.random();
    const success = roll < successChance;

    if (success) {
      // Calculate steal amount
      const stealAmount = Math.floor(targetHoldings * config.robStealPercentage);
      
      // Transfer
      await EconomyService.removeCreditsFromBalances(targetDiscordId, stealAmount, 'both', 'Robbery', 'ROBBERY');
      await EconomyService.addCredits(robberDiscordId, stealAmount, 'Robbery proceeds', 'ROBBERY');

      // Update stats
      await prisma.economyAccount.update({
        where: { userId: robberAccount.userId },
        data: { successfulRobberies: { increment: 1 } },
      });

      // Check for Diamond collectible (0.1% chance)
      if (Math.random() < 0.001) {
        const isNew = await InventoryService.addCollectible(robberDiscordId, 'diamond');
        return {
          success: true,
          amount: stealAmount,
          collectible: isNew ? 'diamond' : null,
          luckyDiceUsed: hasLuckyDice,
          watchdogCount,
        };
      }

      return {
        success: true,
        amount: stealAmount,
        collectible: null,
        luckyDiceUsed: hasLuckyDice,
        watchdogCount,
      };
    } else {
      // Penalty for failed robbery
      const penalty = Math.floor(robberAccount.wallet * 0.1);
      await EconomyService.removeCredits(robberDiscordId, penalty, 'Failed robbery penalty', 'ROBBERY');

      return {
        success: false,
        penalty,
        collectible: null,
        luckyDiceUsed: hasLuckyDice,
        watchdogCount,
      };
    }
  }
}
