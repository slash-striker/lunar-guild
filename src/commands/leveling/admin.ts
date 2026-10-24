import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { LevelService } from '../../services/leveling/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config, isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('level-admin')
    .setDescription('Admin commands for leveling (Owner only)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit-xp')
        .setDescription('Edit a user\'s XP')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to edit XP for')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('The new XP amount')
            .setRequired(true)
            .setMinValue(0)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset-xp')
        .setDescription('Reset a user\'s XP and level')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to reset')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset-leaderboard')
        .setDescription('Reset the entire level leaderboard')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Owner check
    if (!isOwner(interaction.user.id)) {
      const embed = EmbedService.error('Permission Denied', 'This command is restricted to the bot owner.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      await interaction.deferReply();

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'edit-xp':
          await handleEditXP(interaction);
          break;
        case 'reset-xp':
          await handleResetXP(interaction);
          break;
        case 'reset-leaderboard':
          await handleResetLeaderboard(interaction);
          break;
      }
    } catch (error) {
      console.error('Error in level-admin command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your request.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

async function handleEditXP(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  // Ensure user exists
  await prisma.user.upsert({
    where: { discordId: targetUser.id },
    update: {},
    create: {
      discordId: targetUser.id,
      guildId: interaction.guildId!,
    },
  });

  await LevelService.editXP(targetUser.id, amount);

  const embed = EmbedService.admin(
    '✅ XP Edited',
    `Set ${targetUser.toString()}'s XP to **${amount.toLocaleString()}**`
  )
    .setFooter({ text: `Admin: ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleResetXP(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user', true);

  // Ensure user exists
  await prisma.user.upsert({
    where: { discordId: targetUser.id },
    update: {},
    create: {
      discordId: targetUser.id,
      guildId: interaction.guildId!,
    },
  });

  await LevelService.resetXP(targetUser.id);

  const embed = EmbedService.admin(
    '✅ XP Reset',
    `Reset ${targetUser.toString()}'s XP and level to 0 and 1`
  )
    .setFooter({ text: `Admin: ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleResetLeaderboard(interaction: ChatInputCommandInteraction) {
  await LevelService.resetLeaderboard();

  const embed = EmbedService.admin(
    '✅ Leaderboard Reset',
    'All users\' XP and levels have been reset to 0 and 1'
  )
    .setFooter({ text: `Admin: ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
