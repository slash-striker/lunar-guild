import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { LevelService } from '../../services/leveling/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('View your level and XP')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('View another user\'s level')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user') || interaction.user;

      // Ensure user exists
      await prisma.user.upsert({
        where: { discordId: targetUser.id },
        update: {},
        create: {
          discordId: targetUser.id,
          guildId: interaction.guildId!,
        },
      });

      const levelData = await LevelService.getUserLevel(targetUser.id);
      
      if (!levelData) {
        const embed = EmbedService.info('Level', `${targetUser.toString()} hasn't gained any XP yet.`);
        return interaction.editReply({ embeds: [embed] });
      }

      const xpForNextLevel = LevelService.calculateXPRequirement(levelData.level + 1);
      const xpProgress = (levelData.xp / xpForNextLevel) * 100;
      const progressBar = '█'.repeat(Math.floor(xpProgress / 10)) + '░'.repeat(10 - Math.floor(xpProgress / 10));

      const embed = EmbedService.leveling(
        `📊 ${targetUser.username}'s Level`,
        `**Level:** ${levelData.level}\n` +
        `**Current XP:** ${levelData.xp.toLocaleString()}\n` +
        `**XP Required for Level ${levelData.level + 1}:** ${xpForNextLevel.toLocaleString()}\n` +
        `**Progress:** ${progressBar} ${xpProgress.toFixed(1)}%\n` +
        `**Total Messages:** ${levelData.totalMessageCount.toLocaleString()}`
      )
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `User: ${targetUser.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in level command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching level data.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
