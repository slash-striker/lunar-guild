import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('set-doublecoinday')
    .setDescription('Configure double coin day settings (Owner only)')
    .addBooleanOption(option =>
      option.setName('enabled')
        .setDescription('Enable or disable double coin day')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('days')
        .setDescription('Number of days at the beginning of each month')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(15)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      const embed = EmbedService.error('Permission Denied', 'This command is restricted to the bot owner.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      const enabled = interaction.options.getBoolean('enabled');
      const days = interaction.options.getInteger('days');

      const updateData: any = {};
      if (enabled !== null) updateData.doubleCoinDayEnabled = enabled;
      if (days !== null) updateData.doubleCoinDayDays = days;

      await prisma.serverConfig.update({
        where: { guildId: interaction.guildId! },
        data: updateData,
      });

      let description = 'Double coin day settings updated:\n\n';
      if (enabled !== null) description += `• Enabled: ${enabled ? 'Yes' : 'No'}\n`;
      if (days !== null) description += `• Days: First ${days} days of each month\n`;

      const embed = EmbedService.success(
        '✅ Double Coin Day Updated',
        description
      )
        .setFooter({ text: `Admin: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in set-doublecoinday command:', error);
      const embed = EmbedService.error('Error', 'Failed to update double coin day settings.');
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
