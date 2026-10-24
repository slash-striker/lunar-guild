import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('crime')
    .setDescription('Commit a crime for a chance to earn credits'),

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

      // Ensure user exists
      await prisma.user.upsert({
        where: { discordId: interaction.user.id },
        update: {},
        create: {
          discordId: interaction.user.id,
          guildId: interaction.guildId!,
        },
      });

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(interaction.user.id, 'crime');

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          'Cooldown Active',
          `You can commit crime again in **${cooldown}**`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Check for lucky dice
      const hasLuckyDice = await InventoryService.hasItem(interaction.user.id, 'luckyDice');

      // Calculate success chance
      let successChance = 0.5; // 50% base chance
      if (hasLuckyDice) {
        successChance += config.luckyDiceBonus;
      }

      const roll = Math.random();
      const success = roll < successChance;

      // Update crime count
      const account = await EconomyService.getBalance(interaction.user.id);
      await prisma.economyAccount.update({
        where: { userId: account.userId },
        data: { crimesCommitted: { increment: 1 } },
      });

      await CooldownService.setCooldown(interaction.user.id, 'crime');

      if (success) {
        // Random reward between 500 and 2000
        const reward = Math.floor(Math.random() * 1501) + 500;
        await EconomyService.addCredits(interaction.user.id, reward, 'Crime reward', 'CRIME');

        // Check for Ninja collectible (0.1% chance)
        if (Math.random() < 0.001) {
          const isNew = await InventoryService.addCollectible(interaction.user.id, 'ninja');
          
          const embed = EmbedService.success(
            '🔪 Crime Successful',
            `You successfully committed a crime and earned **${reward.toLocaleString()} credits**!\n\n🎉 **You found a collectible! Ninja 🥷**`
          )
            .setFooter({ text: `User: ${interaction.user.tag}` })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        const embed = EmbedService.success(
          '🔪 Crime Successful',
          `You successfully committed a crime and earned **${reward.toLocaleString()} credits**!` +
          (hasLuckyDice ? `\n\n🎲 Your **Lucky Dice** helped improve your odds.` : '')
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        // Penalty - lose between 500 and 2000 credits
        const penalty = Math.floor(Math.random() * 1501) + 500;
        
        try {
          await EconomyService.removeCredits(interaction.user.id, penalty, 'Crime penalty', 'CRIME');
        } catch {
          // User doesn't have enough credits, just skip
        }

        const embed = EmbedService.error(
          '🚔 Crime Failed',
          `You were caught and lost **${penalty.toLocaleString()} credits** as a penalty!` +
          (hasLuckyDice ? `\n\n🎲 Your **Lucky Dice** was used, but it could not save you.` : '')
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error in crime command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while committing crime.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
