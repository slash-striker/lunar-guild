import prisma from '../../database/client.ts';
import { EconomyService } from './index.ts';
import { config } from '../../config/index.ts';

export class WorkService {
  static getJobForShifts(shifts: number) {
    // Find the highest job milestone the user has reached
    let currentJob = config.jobMilestones[0];
    
    for (const milestone of config.jobMilestones) {
      if (shifts >= milestone.shifts) {
        currentJob = milestone;
      }
    }
    
    return currentJob;
  }

  static async work(discordId: string, hasCoffee: boolean = false, hasEnergyDrink: boolean = false) {
    const account = await EconomyService.getBalance(discordId);
    
    // Get current job based on shifts
    const job = this.getJobForShifts(account.workShifts);
    let salary = Math.max(job.salary, config.workBaseSalary); // Ensure minimum salary
    
    // Apply coffee effect
    let outcome = 'normal';
    if (hasCoffee) {
      const roll = Math.random();
      if (roll < config.coffeeEffects.earlyChance) {
        salary *= 2;
        outcome = 'early';
      } else if (roll < config.coffeeEffects.earlyChance + config.coffeeEffects.onTimeChance) {
        outcome = 'ontime';
      } else {
        salary = Math.floor(salary * 0.5);
        outcome = 'late';
        outcome = 'ontime';
      }
    } else {
      // Without coffee, higher chance of being late
      const roll = Math.random();
      if (roll < 0.3) {
        salary = Math.floor(salary * 0.5);
        outcome = 'late';
      }
    }
    
    // Apply energy drink bonus
    if (hasEnergyDrink) {
      salary += config.energyDrinkBonus;
    }
    
    // Update account
    const newShifts = account.workShifts + 1;
    const newJob = this.getJobForShifts(newShifts);
    const promoted = newJob.name !== job.name;
    
    await prisma.economyAccount.update({
      where: { userId: account.userId },
      data: {
        workShifts: { increment: 1 },
        workEarnings: { increment: salary },
        currentJob: newJob.name,
        highestJob: newJob.shifts > account.careerLevel ? newJob.name : account.highestJob,
        careerLevel: promoted ? newJob.shifts : account.careerLevel,
      },
    });
    
    // Add credits
    await EconomyService.addCredits(discordId, salary, 'Work salary', 'WORK');
    
    // Record work history
    await prisma.workHistory.create({
      data: {
        userId: account.userId,
        jobName: job.name,
        salary,
      },
    });
    
    return {
      salary,
      jobName: job.name,
      newJobName: newJob.name,
      promoted,
      outcome,
    };
  }

  static async getWorkStats(discordId: string) {
    const account = await EconomyService.getBalance(discordId);
    const workHistory = await prisma.workHistory.findMany({
      where: { userId: account.userId },
      orderBy: { workedAt: 'desc' },
      take: 10,
    });
    
    return {
      currentJob: account.currentJob,
      highestJob: account.highestJob,
      shifts: account.workShifts,
      totalEarnings: account.workEarnings,
      recentWork: workHistory,
    };
  }
}
