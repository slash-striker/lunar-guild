import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { BankRobberyService } from '../../services/economy/bankrobbery.ts';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

async function notifyMobilePhoneOwners(
  client: ChatInputCommandInteraction['client'],
  initiatorId: string,
): Promise<number> {
  const phoneOwners = await prisma.inventoryItem.findMany({
    where: { itemId: 'mobilePhone', quantity: { gt: 0 } },
    include: { user: true },
  });
  let notified = 0;
  for (const item of phoneOwners) {
    try {
      const user = await client.users.fetch(item.user.discordId);
      await user.send(`📱 **Bank robbery alert:** ${initiatorId === item.user.discordId ? 'You started' : 'A bank robbery has started'} a bank robbery. Use \`/bankrob\` to join.`);
      notified++;
    } catch (error) {
      console.warn(`Could not notify mobile phone owner ${item.user.discordId}`, error);
    }
  }
  return notified;
}

export default {
  data: new SlashCommandBuilder()
    .setName('bankrob')
    .setDescription('Start or join a bank robbery'),

  async execute(interaction: ChatInputCommandInteraction) {
    // Check if in economy channel
    if (interaction.channelId !== config.economyChannelId) {
      const embed = EmbedService.error(
        'Wrong Channel',
        `Economy commands can only be used in <#${config.economyChannelId}>`
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // Ensure user exists
      await prisma.user.upsert({
        where: { discordId: interaction.user.id },
        update: {},
        create: {
          discordId: interaction.user.id,
          guildId: interaction.guildId!,
        },
      });

      // Check if there's an active bank robbery
      const activeRobbery = await BankRobberyService.getActiveBankRobbery();

      if (activeRobbery) {
        // User is joining an existing robbery
        const data = JSON.parse(activeRobbery.payload) as { participants: string[] };
        
        if (data.participants.includes(interaction.user.id)) {
          const embed = EmbedService.warning(
            'Already Participating',
            'You are already participating in this bank robbery!'
          );
          return interaction.editReply({ embeds: [embed] });
        }

        const participantCount = await BankRobberyService.joinBankRobbery(interaction.user.id, activeRobbery.id);
        const remainingSlots = config.bankRobberyMaxParticipants - participantCount;

        const embed = EmbedService.success(
          '🏦 Joined Bank Robbery',
          `You have joined the bank robbery!\n\n` +
          `**Participants:** ${participantCount}/${config.bankRobberyMaxParticipants}\n` +
          `**Remaining Slots:** ${remainingSlots}`
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Check if we have enough participants to execute
        if (participantCount >= config.bankrobMinPlayers) {
          // Execute the robbery
          const result = await BankRobberyService.executeBankRobbery(activeRobbery.id);

          if (result.success) {
            const successEmbed = EmbedService.success(
              '🎉 Bank Robbery Successful!',
              `The bank robbery was successful!\n\n` +
              `**Participants:** ${result.participants}\n` +
              `**Reward per Person:** ${(result.rewardPerPerson || 0).toLocaleString()} credits`
            )
              .setFooter({ text: 'Bank Robbery' })
              .setTimestamp();

            await interaction.followUp({ embeds: [successEmbed] });
          } else {
            const failEmbed = EmbedService.error(
              '🚔 Bank Robbery Failed',
              `The bank robbery was caught by police!\n\n` +
              `**Participants:** ${result.participants}\n` +
              `**Penalty per Person:** ${(result.penalty || 0).toLocaleString()} credits`
            )
              .setFooter({ text: 'Bank Robbery' })
              .setTimestamp();

            await interaction.followUp({ embeds: [failEmbed] });
          }
        }

        return;
      }

      // Starting a new bank robbery
      try {
        const session = await BankRobberyService.startBankRobbery(interaction.user.id);
        const notifiedPhones = await notifyMobilePhoneOwners(interaction.client, interaction.user.id);

        const embed = EmbedService.info(
          '🏦 Bank Robbery Started',
          `You have started a bank robbery!\n\n` +
          `**Participants:** 1/${config.bankRobberyMaxParticipants}\n` +
          `**Minimum Required:** ${config.bankrobMinPlayers}\n\n` +
          `Use \`/bankrob\` to join the robbery!` +
          (notifiedPhones > 0 ? `\n\n📱 **${notifiedPhones} Mobile Phone${notifiedPhones === 1 ? '' : 's'}** notified nearby players.` : '')
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        const joinButton = new ButtonBuilder()
          .setCustomId('bankrob_join')
          .setLabel('Join Robbery')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(joinButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
      } catch (error: any) {
        const embed = EmbedService.error('Error', error.message || 'Failed to start bank robbery');
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error in bankrob command:', error);
      const embed = EmbedService.error('Error', 'An error occurred during the bank robbery.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
