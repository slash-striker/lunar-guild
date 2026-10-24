import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config, isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('credits')
    .setDescription('Manage credits')
    .addSubcommand(subcommand =>
      subcommand
        .setName('give')
        .setDescription('Give credits to another user')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to give credits to')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('The amount of credits to give')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add credits to a user (Owner only)')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to add credits to')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('The amount of credits to add')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove credits from a user (Owner only)')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to remove credits from')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('The amount of credits to remove')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption(option =>
          option.setName('from')
            .setDescription('Where to remove the credits from')
            .setRequired(false)
            .addChoices(
              { name: 'Both wallet and bank', value: 'both' },
              { name: 'Wallet only', value: 'wallet' },
              { name: 'Bank only', value: 'bank' },
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('audit')
        .setDescription('View credit transaction history')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to audit (defaults to yourself)')
            .setRequired(false)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    // Check if in economy channel (except for owner commands)
    if (subcommand !== 'add' && subcommand !== 'remove' && interaction.channelId !== config.economyChannelId) {
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

      switch (subcommand) {
        case 'give':
          await handleGive(interaction);
          break;
        case 'add':
          await handleAdd(interaction);
          break;
        case 'remove':
          await handleRemove(interaction);
          break;
        case 'audit':
          await handleAudit(interaction);
          break;
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 10062) {
        console.warn('Credits interaction expired before it could be acknowledged.');
        return;
      }
      console.error('Error in credits command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your request.');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      }
    }
  },
};

async function handleGive(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  if (targetUser.id === interaction.user.id) {
    const embed = EmbedService.error('Error', 'You cannot give credits to yourself.');
    return interaction.editReply({ embeds: [embed] });
  }

  if (targetUser.bot) {
    const embed = EmbedService.error('Error', 'You cannot give credits to bots.');
    return interaction.editReply({ embeds: [embed] });
  }

  try {
    await EconomyService.transferCredits(interaction.user.id, targetUser.id, amount, 'Transfer');

    const embed = EmbedService.success(
      '💸 Credits Transferred',
      `You gave **${amount.toLocaleString()} credits** to ${targetUser.toString()}`
    )
      .setFooter({ text: `User: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to transfer credits.');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleAdd(interaction: ChatInputCommandInteraction) {
  if (!isOwner(interaction.user.id)) {
    const embed = EmbedService.error('Permission Denied', 'This command is restricted to the bot owner.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  try {
    await EconomyService.addCredits(targetUser.id, amount, 'Admin add', 'ADMIN');

    const embed = EmbedService.success(
      '✅ Credits Added',
      `Added **${amount.toLocaleString()} credits** to ${targetUser.toString()}`
    )
      .setFooter({ text: `Admin: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to add credits.');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  if (!isOwner(interaction.user.id)) {
    const embed = EmbedService.error('Permission Denied', 'This command is restricted to the bot owner.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const balanceSource = interaction.options.getString('from') as 'wallet' | 'bank' | 'both' | null;

  try {
    const removed = await EconomyService.removeCreditsFromBalances(
      targetUser.id,
      amount,
      balanceSource ?? 'both',
      'Admin remove',
      'ADMIN',
    );

    const embed = EmbedService.success(
      '✅ Credits Removed',
      `Removed **${amount.toLocaleString()} credits** from ${targetUser.toString()}.\n` +
      `Wallet: **${removed.wallet.toLocaleString()}** · Bank: **${removed.bank.toLocaleString()}**`
    )
      .setFooter({ text: `Admin: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to remove credits.');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleAudit(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;

  // Only allow users to audit themselves unless they're the owner
  if (targetUser.id !== interaction.user.id && !isOwner(interaction.user.id)) {
    const embed = EmbedService.error('Permission Denied', 'You can only audit your own transaction history.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  try {
    const transactions = await EconomyService.getTransactionHistory(targetUser.id, 20);

    if (transactions.length === 0) {
      const embed = EmbedService.info('Transaction History', 'No transactions found.');
      return interaction.editReply({ embeds: [embed] });
    }
    let largestAmount = 6;
    var amountSetName = ` Amount `;

    for (const transaction of transactions) {
      const amount = `${transaction.amount >= 0 ? '+' : '-'}${Math.abs(transaction.amount).toLocaleString()}`;

      if (amount.length > largestAmount) {
        largestAmount = amount.length;

      }
    }

    if (largestAmount === 7) {
      amountSetName =` Amount  `;
    }
    else if (largestAmount === 8) {
      amountSetName = `  Amount  `;
    }
    else if (largestAmount === 9) {
      amountSetName = `   Amount   `;
    }
    else if (largestAmount === 10) {
      amountSetName = `    Amount    `;
    }
    else if (largestAmount === 11) {
      amountSetName = `     Amount     `;
    }
    else if (largestAmount === 12) {
      amountSetName = `      Amount      `;
    }
    else if (largestAmount === 13) {
      amountSetName = `       Amount       `;
    }
    else if (largestAmount === 14) {
      amountSetName = `        Amount        `;
    }
    else if (largestAmount === 15) {
      amountSetName = `         Amount         `;
    }
    else if (largestAmount === 16) {
      amountSetName = `          Amount          `;
    }
    else if (largestAmount === 17) {
      amountSetName = `           Amount           `;
    }
    else if (largestAmount === 18) {
      amountSetName = `            Amount            `; 
    }

    let largestDate = 0;

    for (const transaction of transactions) {
      const date = new Date(transaction.createdAt).toLocaleDateString();

      if (date.length > largestDate) {
        largestDate = date.length;
      }
    }


    const history = transactions.map((t: any) => {
      const date = new Date(t.createdAt)
        .toLocaleDateString()
        .padEnd(largestDate + 1);

      const isGain = t.amount >= 0;
      const sign = isGain ? '+' : '-';

      const amountStr = `${sign}${Math.abs(t.amount).toLocaleString()}`
        .padEnd(largestAmount);

      const colorCode = isGain ? '\u001b[0;32m' : '\u001b[0;31m';
      const resetCode = '\u001b[0m';


      let typedata = `${t.type}`;

      for (const transaction of transactions) {
        if (transaction.type === 'TRANSFER_IN') {
          if (t.type === 'TRANSFER_IN') {
            typedata = `FROM`;
            break;
          }
        }
        else if (transaction.type === 'BANK_DEPOSIT') {
          if (t.type === 'BANK_DEPOSIT') {
            typedata = `BANK`;
            break;
          }
        }
        else if (transaction.type === 'BANK_WITHDRAW') {
          if (t.type === 'BANK_WITHDRAW') {
            typedata = `BANK`;
            break;
          }
        }
        else if (transaction.type === 'TRANSFER_OUT') {
          if (t.type === 'TRANSFER_OUT') {
            typedata = `FROM`;
            break;
          }
        }
      }

      return `${colorCode}${date}| ${typedata} | ${amountStr} | ${t.reason}${resetCode}`;
    }).join('\n');

    const t = transactions[19];

    const date = new Date(t.createdAt).toLocaleDateString();
    const dateLength = date.length;

    let spaceDate = `Date  `;

    if (dateLength === 9) {
      spaceDate = ` Date  `;
    } else if (dateLength === 10) {
      spaceDate = `  Date  `;
    }
    


    
    

    const embed = EmbedService.info(
      `💳 Transaction History for ${targetUser.tag}`,
      `\`\`\`ansi\n  ${spaceDate} | Type |${amountSetName}| Reason\n${history}\n\`\`\``
    )
      .setFooter({ text: `Showing last ${transactions.length} transactions` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to fetch transaction history.');
    await interaction.editReply({ embeds: [embed] });
  }
}
