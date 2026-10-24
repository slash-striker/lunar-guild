import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';

const JOBS_PER_PAGE = 5;

// Store pagination state
const paginationState = new Map<string, { page: number, messageId: string }>();

export default {
  data: new SlashCommandBuilder()
    .setName('job-list')
    .setDescription('View all available jobs and your current career progress'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const account = await EconomyService.getBalance(interaction.user.id);
      const currentShifts = account.workShifts;
      const page = 1;

      const totalPages = Math.ceil(config.jobMilestones.length / JOBS_PER_PAGE);
      const validPage = Math.max(1, Math.min(page, totalPages));

      const { embed, row } = generateJobListEmbed(account, currentShifts, validPage, totalPages, interaction.user.id);

      const message = await interaction.editReply({ embeds: [embed], components: row ? [row] : [] });

      // Store pagination state
      paginationState.set(interaction.user.id, { page: validPage, messageId: message.id });

      // Create button collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000, // 1 minute
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'You cannot use these buttons.', ephemeral: true });
          return;
        }

        const state = paginationState.get(interaction.user.id);
        if (!state) return;

        let newPage = state.page;
        if (i.customId === 'prev_page') {
          newPage = Math.max(1, state.page - 1);
        } else if (i.customId === 'next_page') {
          newPage = Math.min(totalPages, state.page + 1);
        }

        const { embed: newEmbed, row: newRow } = generateJobListEmbed(account, currentShifts, newPage, totalPages, interaction.user.id);

        await i.update({ embeds: [newEmbed], components: newRow ? [newRow] : [] });

        paginationState.set(interaction.user.id, { page: newPage, messageId: message.id });
      });

      collector.on('end', () => {
        paginationState.delete(interaction.user.id);
        message.edit({ components: [] }).catch(() => {});
      });
    } catch (error) {
      console.error('Error in job-list command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching job information.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

function generateJobListEmbed(account: any, currentShifts: number, page: number, totalPages: number, userId: string) {
  const startIndex = (page - 1) * JOBS_PER_PAGE;
  const endIndex = Math.min(startIndex + JOBS_PER_PAGE, config.jobMilestones.length);
  const displayedJobs = config.jobMilestones.slice(startIndex, endIndex);

  let description = '**Your Career Progress**\n';
  description += `Current Shifts: ${currentShifts}\n`;
  description += `Current Job: **${account.currentJob}**\n`;
  description += `Highest Job: ${account.highestJob}\n\n`;

  description += '**Job Milestones**\n';

  for (const milestone of displayedJobs) {
    const isCurrentJob = milestone.name === account.currentJob;
    const isUnlocked = currentShifts >= milestone.shifts;
    const isNext = currentShifts < milestone.shifts && 
      config.jobMilestones.indexOf(milestone) === 
      config.jobMilestones.findIndex(m => m.shifts > currentShifts);

    let status = '';
    if (isCurrentJob) {
      status = '🟢 **Current**';
    } else if (isUnlocked) {
      status = '✅ Unlocked';
    } else if (isNext) {
      status = '🔓 Next';
    } else {
      status = '🔒 Locked';
    }

    description += `\n${status} **${milestone.name}**\n`;
    description += `   Salary: ${milestone.salary.toLocaleString()} credits\n`;
    description += `   Requires: ${milestone.shifts} shifts\n`;
  }

  description += `\n\nPage ${page}/${totalPages}`;

  const embed = EmbedService.info(
    '💼 Career Path',
    description
  )
    .setFooter({ text: `User ID: ${userId}` })
    .setTimestamp();

  // Create buttons
  const row = new ActionRowBuilder<ButtonBuilder>();
  
  const prevButton = new ButtonBuilder()
    .setCustomId('prev_page')
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === 1);

  const nextButton = new ButtonBuilder()
    .setCustomId('next_page')
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === totalPages);

  row.addComponents(prevButton, nextButton);

  return { embed, row: totalPages > 1 ? row : null };
}
