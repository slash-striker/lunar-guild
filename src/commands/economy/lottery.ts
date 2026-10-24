import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { LotteryService } from '../../services/economy/lottery.ts';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('lottery')
    .setDescription('Participate in the lottery')
    .addSubcommand(subcommand =>
      subcommand
        .setName('buy')
        .setDescription('Buy a lottery ticket')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View current lottery information')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('history')
        .setDescription('View past lottery results')
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
        case 'buy':
          await handleBuy(interaction);
          break;
        case 'info':
          await handleInfo(interaction);
          break;
        case 'history':
          await handleHistory(interaction);
          break;
      }
    } catch (error) {
      console.error('Error in lottery command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your request.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

async function handleBuy(interaction: ChatInputCommandInteraction) {
  // Check balance
  const balance = await EconomyService.getBalance(interaction.user.id);
  if (balance.wallet < config.lotteryCost) {
    const embed = EmbedService.error(
      'Insufficient Funds',
      `You need ${config.lotteryCost.toLocaleString()} credits to buy a lottery ticket.`
    );
    return interaction.editReply({ embeds: [embed] });
  }

  // Remove cost
  await EconomyService.removeCredits(interaction.user.id, config.lotteryCost, 'Lottery ticket', 'LOTTERY');

  // Buy ticket
  try {
    const lottery = await LotteryService.buyTicket(interaction.user.id);

    const timeRemaining = Math.max(0, (lottery.drawnAt?.getTime() ?? Date.now()) - Date.now());
    const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

    const embed = EmbedService.success(
      '🎫 Lottery Ticket Purchased!',
      `You bought a lottery ticket for **${config.lotteryCost.toLocaleString()} credits**!\n\n` +
      `**Time Remaining:** ${hours}h ${minutes}m\n` +
      `**Ticket Price:** ${config.lotteryCost.toLocaleString()} credits`
    )
      .setFooter({ text: `User: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    // Refund if there was an error
    await EconomyService.addCredits(interaction.user.id, config.lotteryCost, 'Lottery refund', 'LOTTERY');
    
    const embed = EmbedService.error('Error', error.message || 'Failed to buy lottery ticket');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleInfo(interaction: ChatInputCommandInteraction) {
  const lottery = await LotteryService.getActiveLottery();

  if (!lottery) {
    const embed = EmbedService.info('Lottery', 'No active lottery. One will start soon!');
    return interaction.editReply({ embeds: [embed] });
  }

  const totalTickets = lottery.entries.length;
  const prizePool = totalTickets * config.lotteryCost * config.lotteryPayoutMultiplier;
  const timeRemaining = Math.max(0, (lottery.drawnAt?.getTime() ?? Date.now()) - Date.now());
  const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

  // Check if user has a ticket
  const user = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
    select: { id: true },
  });
  const hasTicket = lottery.entries.some((e: any) => e.userId === user?.id);

  let description = `**Prize Pool:** ${prizePool.toLocaleString()} credits\n`;
  description += `**Total Tickets:** ${totalTickets}\n`;
  description += `**Time Remaining:** ${hours}h ${minutes}m\n`;
  description += `**Ticket Price:** ${config.lotteryCost.toLocaleString()} credits\n`;
  description += `**Your Ticket:** ${hasTicket ? '✅ Yes' : '❌ No'}`;

  const embed = EmbedService.info(
    '🎰 Active Lottery',
    description
  )
    .setFooter({ text: `Lottery ID: ${lottery.id}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleHistory(interaction: ChatInputCommandInteraction) {
  const history = await LotteryService.getLotteryHistory(10);

  if (history.length === 0) {
    const embed = EmbedService.info('Lottery History', 'No lottery history available yet.');
    return interaction.editReply({ embeds: [embed] });
  }

  // winnerId stores the internal User id, so resolve discordIds for mentions
  const winnerIds = history.map((lottery: any) => lottery.winnerId).filter(Boolean);
  const winnerUsers = await prisma.user.findMany({
    where: { id: { in: winnerIds } },
    select: { id: true, discordId: true },
  });
  const discordIdById = new Map(winnerUsers.map((u: any) => [u.id, u.discordId]));

  const historyText = history.map((lottery: any) => {
    const date = new Date(lottery.drawnAt).toLocaleDateString();
    const discordId = lottery.winnerId ? discordIdById.get(lottery.winnerId) : null;
    const winner = discordId ? `<@${discordId}>` : 'No winner';
    const prize = lottery.totalPool?.toLocaleString() || '0';
    return `${date}: ${winner} won ${prize} credits`;
  }).join('\n');

  const embed = EmbedService.info(
    '📜 Lottery History',
    historyText
  )
    .setFooter({ text: 'Last 10 lotteries' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
