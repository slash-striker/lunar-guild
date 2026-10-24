import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('reset-job')
    .setDescription('Reset a user\'s work job, career, or shifts')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to reset')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reset')
        .setDescription('What to reset')
        .setRequired(true)
        .addChoices(
          { name: 'Job Only', value: 'job' },
          { name: 'Career Level Only', value: 'career' },
          { name: 'Shifts Only', value: 'shifts' },
          { name: 'All (Job + Career + Shifts)', value: 'all' },
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      const embed = EmbedService.error(
        '🚫 Access Denied',
        'This command is restricted to the **bot owner**.'
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      const resetType = interaction.options.getString('reset', true);
      const guildId = interaction.guildId!;

      // Find the user in the database
      const user = await prisma.user.findFirst({
        where: {
          discordId: targetUser.id,
          guildId,
        },
        include: {
          economyAccount: true,
        },
      });

      if (!user || !user.economyAccount) {
        const embed = EmbedService.error(
          '❌ User Not Found',
          'That user does not have an economy account in this server.'
        );
        return interaction.editReply({ embeds: [embed] });
      }

      const account = user.economyAccount;
      const previousJob = account.currentJob;
      const previousHighest = account.highestJob;
      const previousCareerLevel = account.careerLevel;
      const previousShifts = account.workShifts;

      // Build update data based on reset type
      const updateData: any = {};
      let resetDescription: string[] = [];

      if (resetType === 'job' || resetType === 'all') {
        updateData.currentJob = 'Unemployed';
        updateData.careerLevel = 0;
        resetDescription.push(`**Job**: ${previousJob} → Unemployed`, `**Career Level**: ${previousCareerLevel} → 0`);
      }

      if (resetType === 'career' || resetType === 'all') {
        updateData.careerLevel = 0;
        if (resetType === 'career') {
          resetDescription.push(`**Career Level**: ${previousCareerLevel} → 0`);
        }
      }

      if (resetType === 'shifts' || resetType === 'all') {
        updateData.workShifts = 0;
        resetDescription.push(`**Work Shifts**: ${previousShifts} → 0`);
      }

      // Apply the update
      await prisma.economyAccount.update({
        where: { id: account.id },
        data: updateData,
      });

      // Clear work cooldown if job or all is being reset
      if (resetType === 'job' || resetType === 'all') {
        await prisma.cooldown.deleteMany({
          where: {
            userId: user.id,
            command: 'work',
          },
        });
        resetDescription.push(`**Work Cooldown**: Cleared`);
      }

      const embed = EmbedService.success(
        '💼 Job System Reset',
        [
          `### ${targetUser.tag}`,
          '',
          `The user's job data has been successfully reset.`,
          '',
          `📋 **Previous Data**`,
          `> Job: **${previousJob}**`,
          `> Highest Job: **${previousHighest}**`,
          `> Career Level: **${previousCareerLevel}**`,
          `> Work Shifts: **${previousShifts}**`,
          '',
          `🔄 **Reset Changes**`,
          ...resetDescription,
          '',
          `🛠️ **Reset By**`,
          `> ${interaction.user}`,
        ].join('\n')
      )
        .setFooter({ text: 'Admin Panel • Job Management' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 10062) {
        console.warn('Reset-job interaction expired before it could be acknowledged.');
        return;
      }
      console.error('Error in reset-job command:', error);
      const embed = EmbedService.error(
        '💥 Reset Failed',
        'I couldn\'t reset that user\'s job data. Please try again.'
      );
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ embeds: [embed] });
      }
      return;
    }
  },
};
