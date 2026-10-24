import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('ec-stats')
    .setDescription('View your economy statistics')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('View another user\'s statistics')
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

      const account = await EconomyService.getBalance(targetUser.id);
      const collectibles = await InventoryService.getCollectibles(targetUser.id);

      let description = '**💼 Work Statistics:**\n';
      description += `Current Job: ${account.currentJob}\n`;
      description += `Highest Job: ${account.highestJob}\n`;
      description += `Shifts Worked: ${account.workShifts.toLocaleString()}\n`;
      description += `Work Earnings: ${account.workEarnings.toLocaleString()} credits\n\n`;

      description += '**🎣 Fishing Statistics:**\n';
      description += `Times Fished: ${account.fishingCount.toLocaleString()}\n\n`;

      description += '**💰 Robbery Statistics:**\n';
      description += `Successful Robberies: ${account.successfulRobberies.toLocaleString()}\n\n`;

      description += '**🔪 Crime Statistics:**\n';
      description += `Crimes Committed: ${account.crimesCommitted.toLocaleString()}\n\n`;

      description += '**🤲 Beg Statistics:**\n';
      description += `Beg Attempts: ${account.begAttempts.toLocaleString()}\n\n`;

      description += '**🎫 Gambling Statistics:**\n';
      description += `Scratchcards Bought: ${account.scratchcardsPurchased.toLocaleString()}\n`;
      description += `Lotteries Won: ${account.lotteriesWon.toLocaleString()}\n`;
      description += `Lottery Participation: ${account.lotteryParticipation.toLocaleString()}\n`;
      description += `Lottery Amount Spent: ${account.lotteryAmountSpent.toLocaleString()} credits\n\n`;

      if (collectibles.length > 0) {
        description += '**🎉 Collectibles:**\n';
        for (const uc of collectibles) {
          description += `${uc.collectible.emoji} **${uc.collectible.name}** (${uc.collectible.rarity})\n`;
        }
      } else {
        description += '**🎉 Collectibles:**\nNone yet!\n';
      }

      const embed = EmbedService.info(
        `📊 ${targetUser.username}'s Economy Statistics`,
        description
      )
        .setFooter({ text: `User: ${targetUser.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in ec-stats command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching statistics.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
