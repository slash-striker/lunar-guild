import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('set-interest')
    .setDescription('Set the bank interest rate (Owner only)')
    .addNumberOption(option =>
      option.setName('rate')
        .setDescription('Interest rate as a percentage (e.g., 5 for 5%)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      const embed = EmbedService.error('Permission Denied', 'This command is restricted to the bot owner.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      const rate = interaction.options.getNumber('rate', true);
      const rateAsDecimal = rate / 100;

      // Store in server config
      await prisma.serverConfig.update({
        where: { guildId: interaction.guildId! },
        data: { bankInterestRate: rateAsDecimal },
      });

      const embed = EmbedService.success(
        '✅ Interest Rate Updated',
        `Bank interest rate has been set to **${rate}%** per day.`
      )
        .setFooter({ text: `Admin: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in set-interest command:', error);
      const embed = EmbedService.error('Error', 'Failed to update interest rate.');
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
