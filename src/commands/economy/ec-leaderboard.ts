import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('ec-leaderboard')
    .setDescription('View the economy leaderboard')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of leaderboard')
        .setRequired(false)
        .addChoices(
          { name: 'Wallet', value: 'wallet' },
          { name: 'Bank', value: 'bank' },
          { name: 'Net Worth', value: 'networth' }
        )
    )
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number')
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const type = (interaction.options.getString('type') || 'networth') as 'wallet' | 'bank' | 'networth';
      const page = interaction.options.getInteger('page') || 1;
      const limit = 10;
      const offset = (page - 1) * limit;

      const leaderboard = await EconomyService.getLeaderboard(type, limit, offset, config.botUserId);
      if (leaderboard.length === 0) {
        const embed = EmbedService.info('Leaderboard', 'No economy data available yet.');
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
        
        let amount: number;
        if (type === 'wallet') {
          amount = entry.wallet;
        } else if (type === 'bank') {
          amount = entry.bank;
        } else {
          amount = entry.wallet + entry.bank;
        }

        const member = members[index];
        const username = member?.displayName || member?.user?.tag || entry.user?.discordId || 'Unknown';
        
        return `${medal} ${username} - 🪙 ${amount.toLocaleString()}`;
      }).join('\n');

      const typeName = type === 'wallet' ? 'Holding' : type === 'bank' ? 'Bank' : 'Net Worth';

      const embed = EmbedService.economy(
        `💰 Economy Leaderboard - Top 10 - ${typeName}`,
        leaderboardText
      )
        .setFooter({ text: `Page ${page}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      if (interaction.guild) {
        EconomyService.syncCreditsLeaderRole(interaction.guild, type, config.botUserId).catch(error => {
          console.error('Could not synchronize credits leader role:', error);
        });
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 10062) {
        console.warn('Economy leaderboard interaction expired before it could be acknowledged.');
        return;
      }
      console.error('Error in ec-leaderboard command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching the leaderboard.');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      }
    }
  },
};
