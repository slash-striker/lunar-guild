import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { RobberyService } from '../../services/economy/robbery.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

const ROBBABLE_BOT_ID = '1542559878126641343';

export default {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to rob')
        .setRequired(true)
    ),

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

      const targetUser = interaction.options.getUser('user', true);

      // Validation
      if (targetUser.id === interaction.user.id) {
        const embed = EmbedService.error('Error', 'You cannot rob yourself.');
        return interaction.editReply({ embeds: [embed] });
      }

      if (targetUser.bot && targetUser.id !== ROBBABLE_BOT_ID) {
        const embed = EmbedService.error('Error', 'You cannot rob bots.');
        return interaction.editReply({ embeds: [embed] });
      }

      // Ensure users exist
      await prisma.user.upsert({
        where: { discordId: interaction.user.id },
        update: {},
        create: {
          discordId: interaction.user.id,
          guildId: interaction.guildId!,
        },
      });

      await prisma.user.upsert({
        where: { discordId: targetUser.id },
        update: {},
        create: {
          discordId: targetUser.id,
          guildId: interaction.guildId!,
        },
      });

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(interaction.user.id, 'rob');

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          'Cooldown Active',
          `You can rob again in **${cooldown}**`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Check for lucky dice
      const hasLuckyDice = await InventoryService.hasItem(interaction.user.id, 'luckyDice');

      // Attempt robbery
      const result = await RobberyService.robUser(interaction.user.id, targetUser.id, hasLuckyDice);
      await CooldownService.setCooldown(interaction.user.id, 'rob');

      if (result.success) {
        let description = `You successfully robbed ${targetUser.toString()} and stole **${(result.amount || 0).toLocaleString()} credits**!`;
        if (result.luckyDiceUsed) description += `\n🎲 Your **Lucky Dice** helped improve your odds.`;
        if (result.watchdogCount > 0) description += `\n🐕 The target's **${result.watchdogCount} Watchdog${result.watchdogCount === 1 ? '' : 's'}** reduced your odds.`;
        
        if (result.collectible) {
          description += `\n\n🎉 **You found a collectible! Diamond 💎**`;
        }

        const embed = EmbedService.success(
          '💰 Robbery Successful',
          description
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = EmbedService.error(
          '💔 Robbery Failed',
          `You were caught and lost **${(result.penalty || 0).toLocaleString()} credits** as a penalty!`
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error: any) {
      console.error('Error in rob command:', error);
      const embed = EmbedService.error('Error', error.message || 'An error occurred during the robbery.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
