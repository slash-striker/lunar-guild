import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('View your balance')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to check balance for (defaults to yourself)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Check if in economy channel
    if (interaction.channelId !== config.economyChannelId) {
      const embed = EmbedService.error(
        'Wrong Channel',
        `Economy commands can only be used in <#${config.economyChannelId}>`
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    try {
      await interaction.deferReply();

      const targetUser =
        interaction.options.getUser('user') || interaction.user;

      /*
       * ─────────────────────────────────────────
       * Processing animation
       * ─────────────────────────────────────────
       */

      const processingEmbed = EmbedService.economy(
        `> 💰 **Accessing financial records...**\n\n` +
        `\`[░░░░░░░░░░░░░░░░]\` **0%**\n\n` +
        `🔐 Verifying account...`
      )
        .setAuthor({
          name: targetUser.username,
          iconURL: targetUser.displayAvatarURL(),
        })
        .setColor(0x5865f2)
        .setTimestamp();

      await interaction.editReply({
        embeds: [processingEmbed],
      });

      // Small delay so the processing effect is actually visible
      await new Promise(resolve => setTimeout(resolve, 350));

      const processingEmbed2 = EmbedService.economy(
        `> 💰 **Accessing financial records...**\n\n` +
        `\`[██████░░░░░░░░░░]\` **40%**\n\n` +
        `🔎 Loading account data...`
      )
        .setAuthor({
          name: targetUser.username,
          iconURL: targetUser.displayAvatarURL(),
        })
        .setColor(0x5865f2)
        .setTimestamp();

      await interaction.editReply({
        embeds: [processingEmbed2],
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      /*
       * ─────────────────────────────────────────
       * Database / economy processing
       * ─────────────────────────────────────────
       */

      // Ensure user exists in the database
      await prisma.user.upsert({
        where: {
          discordId: targetUser.id,
        },
        update: {},
        create: {
          discordId: targetUser.id,
          guildId: interaction.guildId!,
        },
      });

      // Apply bank interest first
      const interest = await EconomyService.applyBankInterest(
        targetUser.id
      );

      const account = await EconomyService.getBalance(targetUser.id);

      const wallet = account.wallet;
      const bank = account.bank;
      const totalBalance = wallet + bank;

      /*
       * ─────────────────────────────────────────
       * Balance calculations
       * ─────────────────────────────────────────
       */

      const walletPercentage =
        totalBalance > 0
          ? Math.round((wallet / totalBalance) * 100)
          : 0;

      const bankPercentage =
        totalBalance > 0
          ? Math.round((bank / totalBalance) * 100)
          : 0;

      // Visual balance bar
      const barLength = 18;

      const walletBlocks = Math.round(
        (wallet / (totalBalance || 1)) * barLength
      );

      const bankBlocks = barLength - walletBlocks;

      const balanceBar =
        '🟩'.repeat(walletBlocks) +
        '🟦'.repeat(bankBlocks);

      /*
       * ─────────────────────────────────────────
       * Final balance embed
       * ─────────────────────────────────────────
       */

      let description =
        ` 🪙 ${totalBalance.toLocaleString()} Credits\n\n` +
        ` 📊 Portfolio Distribution\n` +
        `${balanceBar}\n\n` +
        `🟩 **Wallet** ${walletPercentage}%` +
        `　•　` +
        `🟦 **Bank** ${bankPercentage}%\n\n`;

      // Add interest notification
      if (interest > 0) {
        description +=
          `> 📈 **Interest earned!**\n` +
          `> Your bank generated **+${interest.toLocaleString()} credits** this period.\n\n`;
      }

      description +=
        `💵 Wallet: **${wallet.toLocaleString()}** credits\n` +
        `🏦 Bank: **${bank.toLocaleString()}** credits`;

      const embed = EmbedService.economy('Balance', description)
        .setAuthor({
          name: `${targetUser.username}'s Balance`,
          iconURL: targetUser.displayAvatarURL(),
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setFooter({
          text: '🏦 Bank deposits earn interest automatically',
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error in balance command:', error);

      const embed = EmbedService.error(
        'Error',
        'An error occurred while fetching balance.'
      );

      await interaction.editReply({
        embeds: [embed],
      });
    }
  },
};
