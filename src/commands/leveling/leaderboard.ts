import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { LevelService } from '../../services/leveling/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config, isOwner } from '../../config/index.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('level-leaderboard')
    .setDescription('View the level leaderboard')
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number')
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const page = interaction.options.getInteger('page') || 1;
      const limit = 10;
      const offset = (page - 1) * limit;

      const leaderboard = await LevelService.getLeaderboard(limit, offset);

      if (leaderboard.length === 0) {
        const embed = EmbedService.info('Leaderboard', 'No level data available yet.');
        return interaction.editReply({ embeds: [embed] });
      }

      // Fetch all members for better username resolution
      const memberPromises = leaderboard.map((entry: any) => {
        const cachedMember = interaction.guild?.members.cache.get(entry.user?.discordId);
        if (cachedMember) return Promise.resolve(cachedMember);
        if (interaction.guild) {
          return interaction.guild.members.fetch(entry.user?.discordId).catch(() => null);
        }
        return Promise.resolve(null);
      });
      
      const members = await Promise.all(memberPromises);

      const leaderboardText = leaderboard.map((entry: any, index: number) => {
        const rank = offset + index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
        
        const member = members[index];
        const username = member?.displayName || member?.user?.tag || entry.user?.discordId || 'Unknown';
        
        return `${medal} ${username} - Level ${entry.level} (${entry.xp.toLocaleString()} XP)`;
      }).join('\n');

      const embed = EmbedService.leveling(
        '🏆 Level Leaderboard - Top 10',
        leaderboardText
      )
        .setFooter({ text: `Page ${page}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in leaderboard command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching the leaderboard.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
