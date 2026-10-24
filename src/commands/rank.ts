import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { EmbedService } from '../embeds/index.ts';
import { LevelService } from '../services/leveling/index.ts';
import prisma from '../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View a user’s leveling rank')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User whose rank you want to view')
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();
      const target = interaction.options.getUser('user') ?? interaction.user;

      await prisma.user.upsert({
        where: { discordId: target.id },
        update: {},
        create: { discordId: target.id, guildId: interaction.guildId! },
      });
      const levelData = await LevelService.getUserLevel(target.id);
      if (!levelData) {
        await interaction.editReply({
          embeds: [EmbedService.info('Level Rank', `${target} has not earned any XP yet.`)],
        });
        return;
      }

      const rank = await LevelService.getUserRank(target.id);
      const required = LevelService.calculateXPRequirement(levelData.level + 1);
      const progress = Math.min(100, (levelData.xp / required) * 100);
      const bar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));
      const embed = EmbedService.leveling(
        `🏆 ${target.username}'s Rank`,
        `**Server Rank:** #${rank ?? '—'}\n` +
        `**Level:** ${levelData.level}\n` +
        `**XP:** ${levelData.xp.toLocaleString()} / ${required.toLocaleString()}\n` +
        `**Progress:** ${bar} ${progress.toFixed(1)}%\n` +
        `**Messages:** ${levelData.totalMessageCount.toLocaleString()}`,
      )
        .setThumbnail(target.displayAvatarURL({ size: 256 }))
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in rank command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [EmbedService.error('Error', 'Unable to fetch leveling rank.')] });
      }
    }
  },
};
