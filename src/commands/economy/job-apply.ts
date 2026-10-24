import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('job-apply')
    .setDescription('Apply for a job you have unlocked')
    .addStringOption(option =>
      option.setName('job')
        .setDescription('The job to apply for')
        .setRequired(true)
        .addChoices(
          ...config.jobMilestones.map(m => ({ name: m.name, value: m.name }))
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const jobName = interaction.options.getString('job', true);
      const account = await EconomyService.getBalance(interaction.user.id);
      const currentShifts = account.workShifts;

      // Find the job milestone
      const jobMilestone = config.jobMilestones.find(m => m.name === jobName);
      
      if (!jobMilestone) {
        const embed = EmbedService.error('Invalid Job', 'That job does not exist.');
        return interaction.editReply({ embeds: [embed] });
      }

      // Check if user has unlocked this job
      if (currentShifts < jobMilestone.shifts) {
        const embed = EmbedService.error(
          'Job Locked',
          `You need ${jobMilestone.shifts} shifts to apply for **${jobName}**.\n` +
          `You currently have ${currentShifts} shifts.`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Update user's current job
      await prisma.economyAccount.update({
        where: { userId: account.userId },
        data: { currentJob: jobName },
      });

      const embed = EmbedService.success(
        '🎉 Job Application Accepted!',
        `You are now working as a **${jobName}**!\n\n` +
        `Salary: ${jobMilestone.salary.toLocaleString()} credits per shift`
      )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in job-apply command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while applying for the job.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
