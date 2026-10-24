
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('cooldowns')
    .setDescription('View your active command cooldowns'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const commands = [
        { name: 'Work', key: 'work', emoji: '💼' },
        { name: 'Fish', key: 'fish', emoji: '🎣' },
        { name: 'Scratchcard', key: 'scratchcard', emoji: '🎫' },
        { name: 'Rob', key: 'rob', emoji: '🔫' },
        { name: 'Beg', key: 'beg', emoji: '🙏' },
        { name: 'Bank Robbery', key: 'bank_robbery', emoji: '🏦' },
        { name: 'Crime', key: 'crime', emoji: '🔪' },
        { name: 'Blackjack', key: 'blackjack', emoji: '🃏' },
        { name: 'Match Pairs', key: 'matchpairs', emoji: '🧩' },
        { name: '5 Dice', key: 'fivedice', emoji: '🎲' },
        { name: 'Lights Out', key: 'lightsout', emoji: '💡' },
        { name: 'Mastermind', key: 'mastermind', emoji: '🧠' },
        { name: 'Hangman', key: 'hangman', emoji: '☠️' },
        { name: 'High/Low', key: 'highlow', emoji: '📈' },
        { name: 'Rock Paper Scissors', key: 'rps', emoji: '✂️' },
        { name: 'Tic Tac Toe', key: 'tictactoe', emoji: '⭕' },
      ];

      const getCooldownEmbed = async () => {
        const cooldowns: Array<{
          name: string;
          emoji: string;
          remaining: number;
          time: string;
        }> = [];

        for (const cmd of commands) {
          const expiresAt = await CooldownService.getExpiryTime(
            interaction.user.id,
            cmd.key
          );
          const remaining = expiresAt
            ? Math.max(0, expiresAt.getTime() - Date.now())
            : 0;

          let time = 'Ready';

          if (expiresAt) {
            const timestamp = Math.floor(expiresAt.getTime() / 1000);
            time = `<t:${timestamp}:t> (<t:${timestamp}:R>)`;
          }

          cooldowns.push({
            name: cmd.name,
            emoji: cmd.emoji,
            remaining,
            time,
          });
        }

        const ready = cooldowns.filter((cmd) => cmd.remaining <= 0);
        const active = cooldowns.filter((cmd) => cmd.remaining > 0);

        let description =
          `**COMMAND STATUS**\n` +
          `> ${ready.length}/${cooldowns.length} commands ready to use\n\n`;

        if (active.length > 0) {
          description += `⏳ **ON COOLDOWN**\n`;

          for (const cmd of active) {
            description +=
              `${cmd.emoji} **${cmd.name}**\n` +
              `└─ ⏱️ **${cmd.time}** remaining\n`;
          }

          description += `\n`;
        }

        if (ready.length > 0) {
          description += `🟢 **READY TO USE**\n`;

          for (const cmd of ready) {
            description +=
              `${cmd.emoji} **${cmd.name}** ── 🟢 Ready\n`;
          }
        }

        if (active.length === 0) {
          description +=
            `🎉 **Everything is ready!**\n` +
            `Go make some money. 💰`;
        }

        return EmbedService.info(
          '⏱️ Command Cooldowns',
          description
        )
          .setFooter({
            text: `${interaction.user.tag} • Economy Dashboard`,
          })
          .setTimestamp();
      };

      const refreshButton = new ButtonBuilder()
        .setCustomId('cooldowns_refresh')
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        refreshButton
      );

      const embed = await getCooldownEmbed();

      const message = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15 * 60 * 1000,
      });

      collector.on('collect', async (buttonInteraction) => {
        // Only allow the person who opened the cooldown menu to refresh it.
        if (buttonInteraction.user.id !== interaction.user.id) {
          return buttonInteraction.reply({
            content: '❌ This cooldown dashboard belongs to someone else.',
            ephemeral: true,
          });
        }

        if (buttonInteraction.customId === 'cooldowns_refresh') {
          const refreshedEmbed = await getCooldownEmbed();

          await buttonInteraction.update({
            embeds: [refreshedEmbed],
            components: [row],
          });
        }
      });

      collector.on('end', async () => {
        try {
          const disabledButton = ButtonBuilder.from(refreshButton)
            .setDisabled(true);

          const disabledRow =
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              disabledButton
            );

          await interaction.editReply({
            components: [disabledRow],
          });
        } catch {
          // Message may have been deleted.
        }
      });
    } catch (error) {
      console.error('Error in cooldowns command:', error);

      const embed = EmbedService.error(
        '💥 Something Went Wrong',
        'I couldn’t retrieve your cooldowns. Please try again in a moment.'
      );

      await interaction.editReply({
        embeds: [embed],
      });
    }
  },
};
