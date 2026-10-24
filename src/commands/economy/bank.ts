import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Manage your bank account')
    .addSubcommand(subcommand =>
      subcommand
        .setName('deposit')
        .setDescription('Deposit credits to your bank')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('The amount to deposit')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('withdraw')
        .setDescription('Withdraw credits from your bank')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('The amount to withdraw')
            .setRequired(true)
            .setMinValue(1)
        )
    ),

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

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'deposit':
          await handleDeposit(interaction);
          break;
        case 'withdraw':
          await handleWithdraw(interaction);
          break;
      }
    } catch (error) {
      console.error('Error in bank command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your request.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

async function handleDeposit(interaction: ChatInputCommandInteraction) {
  const amount = interaction.options.getInteger('amount', true);

  try {
    await EconomyService.depositToBank(interaction.user.id, amount);

    const balance = await EconomyService.getBalance(interaction.user.id);

    const embed = EmbedService.success(
      '🏦 Deposit Successful',
      `Deposited **${amount.toLocaleString()} credits** to your bank.\n\n` +
      `**Wallet:** ${balance.wallet.toLocaleString()} credits\n` +
      `**Bank:** ${balance.bank.toLocaleString()} credits`
    )
      .setFooter({ text: `User: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to deposit credits.');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleWithdraw(interaction: ChatInputCommandInteraction) {
  const amount = interaction.options.getInteger('amount', true);

  try {
    await EconomyService.withdrawFromBank(interaction.user.id, amount);

    const balance = await EconomyService.getBalance(interaction.user.id);

    const embed = EmbedService.success(
      '🏦 Withdrawal Successful',
      `Withdrew **${amount.toLocaleString()} credits** from your bank.\n\n` +
      `**Wallet:** ${balance.wallet.toLocaleString()} credits\n` +
      `**Bank:** ${balance.bank.toLocaleString()} credits`
    )
      .setFooter({ text: `User: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to withdraw credits.');
    await interaction.editReply({ embeds: [embed] });
  }
}
