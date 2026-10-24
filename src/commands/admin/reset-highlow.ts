import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner } from '../../config/index.ts';
import { resetHighLowStats } from '../games/highlow.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('reset-highlow')
    .setDescription("Reset a player's High/Low statistics")
    .addUserOption(option => option.setName('user').setDescription('Player to reset').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ embeds: [EmbedService.error('Access Denied', 'This command is restricted to the bot owner.')], ephemeral: true });
    }
    const target = interaction.options.getUser('user', true);
    await resetHighLowStats(target.id);
    return interaction.reply({ embeds: [EmbedService.success('High/Low Reset', `Reset High/Low statistics for **${target.tag}**.`)] });
  },
};
