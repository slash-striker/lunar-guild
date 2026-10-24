import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { WorkService } from '../../services/economy/work.ts';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';
import { InventoryService } from '../../services/inventory/index.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work to earn credits'),

  async execute(interaction: ChatInputCommandInteraction) {
    // Check if in economy channel
    if (interaction.channelId !== config.economyChannelId) {
      const embed = EmbedService.error(
        'Wrong Channel',
        `Economy commands can only be used in <#${config.economyChannelId}>`
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(interaction.user.id, 'work');

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          'Cooldown Active',
          `You can work again in **${cooldown}**`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Consumables are checked and removed before applying their effects.
      const hasCoffee = await InventoryService.hasItem(interaction.user.id, 'coffee');
      const hasEnergyDrink = await InventoryService.hasItem(interaction.user.id, 'energyDrink');
      const usedItems: string[] = [];
      if (hasCoffee) {
        await InventoryService.removeItem(interaction.user.id, 'coffee');
        usedItems.push('☕ Coffee');
      }
      if (hasEnergyDrink) {
        await InventoryService.removeItem(interaction.user.id, 'energyDrink');
        usedItems.push('🥤 Energy Drink');
      }

      // Perform work
      const result = await WorkService.work(interaction.user.id, hasCoffee, hasEnergyDrink);
      await CooldownService.setCooldown(interaction.user.id, 'work');

      let title = `Work - ${interaction.user.username}`;
      let description = '';

      if (result.outcome === 'late') {
        description = `You worked as a **${result.jobName}** but you forgot to clock in!\n`;
        description += `You were paid half your usual wage and earned 🪙**${result.salary.toLocaleString()} Credits**.\n\n`;
        description += `_Buy a coffee from the shop to prevent this from happening again!_`;
      } else {
        description = `You worked as a **${result.jobName}** and earned **${result.salary.toLocaleString()} credits**!`;
        
        if (result.promoted) {
          description += `\n\n🎉 **PROMOTION!** You've unlocked **${result.newJobName}**!\n`;
          description += `Use \`/job-list\` to view your career path and \`/job-apply\` to apply for your new job!`;
        }

        if (result.outcome === 'early') {
          description += `\n⚡ You arrived early and earned 2x salary!`;
        }
      }
      if (usedItems.length > 0) {
        description += `\n\n🧰 Items used: **${usedItems.join(' + ')}**`;
      }

      const embed = EmbedService.success(
        title,
        description
      )
        .setFooter({ text: `User: ${interaction.user.tag} • Shifts: ${result.promoted ? '?' : 'current'}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in work command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your work.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
