import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import { withGameLock } from '../../services/game-lock.ts';
import prisma from '../../database/client.ts';

// Store scratchcard game state
const scratchcardGames = new Map<string, {
  userId: string;
  revealed: number[];
  results: ('win' | 'lose')[];
  winPosition: number;
  cost: number;
  messageId: string;
}>();

export default {
  data: new SlashCommandBuilder()
    .setName('scratchcard')
    .setDescription('Buy a scratchcard for a chance to win credits'),

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

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(interaction.user.id, 'scratchcard');

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          'Cooldown Active',
          `You can buy another scratchcard in **${cooldown}**`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Check balance
      const balance = await EconomyService.getBalance(interaction.user.id);
      const scratchcardCost = 100; // Fixed cost for scratchcard

      if (balance.wallet < scratchcardCost) {
        const embed = EmbedService.error(
          'Insufficient Funds',
          `You need ${scratchcardCost} credits to buy a scratchcard.`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Remove cost
      await EconomyService.removeCredits(interaction.user.id, scratchcardCost, 'Scratchcard purchase', 'SCRATCHCARD');

      // Update stats
      const account = await EconomyService.getBalance(interaction.user.id);
      await prisma.economyAccount.update({
        where: { userId: account.userId },
        data: { scratchcardsPurchased: { increment: 1 } },
      });

      await CooldownService.setCooldown(interaction.user.id, 'scratchcard');

      // Determine if this is a winning card (30% chance)
      const isWinningCard = Math.random() < 0.3;
      
      // Generate results
      const results: ('win' | 'lose')[] = Array(9).fill('lose');
      let winPosition = -1;
      
      if (isWinningCard) {
        winPosition = Math.floor(Math.random() * 9);
        results[winPosition] = 'win';
      }

      // Create button grid
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < 3; i++) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let j = 0; j < 3; j++) {
          const index = i * 3 + j;
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`scratch_${interaction.user.id}_${index}`)
              .setLabel('?')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(row);
      }

      const embed = EmbedService.info(
        '🎫 Scratchcard',
        'Click the boxes to reveal your prizes! Find the 💰 to win!'
      )
        .setFooter({ text: `User: ${interaction.user.tag} • Cost: ${scratchcardCost} credits` })
        .setTimestamp();

      const message = await interaction.editReply({ embeds: [embed], components: rows });

      // Store game state
      scratchcardGames.set(interaction.user.id, {
        userId: interaction.user.id,
        revealed: [],
        results,
        winPosition,
        cost: scratchcardCost,
        messageId: message.id,
      });

      // Create button collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000, // 1 minute
      });

      collector.on('collect', (i) => withGameLock(interaction.user.id, i, async () => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'This is not your scratchcard!', ephemeral: true });
          return;
        }

        const game = scratchcardGames.get(interaction.user.id);
        if (!game) return;

        const index = parseInt(i.customId.split('_')[2]);
        
        if (game.revealed.includes(index)) {
          await i.reply({ content: 'This box is already revealed!', ephemeral: true });
          return;
        }

        game.revealed.push(index);

        // Update button
        const buttonIndex = index;
        const rowIndex = Math.floor(buttonIndex / 3);
        const colIndex = buttonIndex % 3;
        
        const newRows: ActionRowBuilder<ButtonBuilder>[] = [];
        for (let r = 0; r < 3; r++) {
          const row = new ActionRowBuilder<ButtonBuilder>();
          for (let c = 0; c < 3; c++) {
            const idx = r * 3 + c;
            if (game.revealed.includes(idx)) {
              const isWin = game.results[idx] === 'win';
              row.addComponents(
                new ButtonBuilder()
                  .setCustomId(`scratch_${interaction.user.id}_${idx}`)
                  .setLabel(isWin ? '💰' : '❌')
                  .setStyle(isWin ? ButtonStyle.Success : ButtonStyle.Danger)
                  .setDisabled(true)
              );
            } else {
              row.addComponents(
                new ButtonBuilder()
                  .setCustomId(`scratch_${interaction.user.id}_${idx}`)
                  .setLabel('?')
                  .setStyle(ButtonStyle.Secondary)
              );
            }
          }
          newRows.push(row);
        }

        let gameEnded = false;
        let description = 'Click the boxes to reveal your prizes!';

        if (game.results[index] === 'win') {
          // User won!
          gameEnded = true;
          const reward = Math.floor(Math.random() * (config.scratchcardRewards.max - config.scratchcardRewards.min + 1)) + config.scratchcardRewards.min;
          await EconomyService.addCredits(interaction.user.id, reward, 'Scratchcard win', 'SCRATCHCARD');
          
          const winEmbed = EmbedService.success(
            '🎫 You Won!',
            `Congratulations! You found the money bag and won **${reward.toLocaleString()} credits**!`
          )
            .setFooter({ text: `User: ${interaction.user.tag}` })
            .setTimestamp();

          // Disable all buttons
          const finalRows: ActionRowBuilder<ButtonBuilder>[] = [];
          for (let r = 0; r < 3; r++) {
            const row = new ActionRowBuilder<ButtonBuilder>();
            for (let c = 0; c < 3; c++) {
              const idx = r * 3 + c;
              const isWin = game.results[idx] === 'win';
              const isRevealed = game.revealed.includes(idx);
              row.addComponents(
                new ButtonBuilder()
                  .setCustomId(`scratch_${interaction.user.id}_${idx}`)
                  .setLabel(isRevealed ? (isWin ? '💰' : '❌') : '?')
                  .setStyle(isRevealed ? (isWin ? ButtonStyle.Success : ButtonStyle.Danger) : ButtonStyle.Secondary)
                  .setDisabled(true)
              );
            }
            finalRows.push(row);
          }

          await i.update({ embeds: [winEmbed], components: finalRows });
          scratchcardGames.delete(interaction.user.id);
          collector.stop();
          return;
        }

        if (game.revealed.length === 9) {
          // User lost - revealed all boxes without winning
          gameEnded = true;
          
          const loseEmbed = EmbedService.error(
            '🎫 Better Luck Next Time',
            'You didn\'t find the money bag this time. Try again!'
          )
            .setFooter({ text: `User: ${interaction.user.tag}` })
            .setTimestamp();

          // Reveal all and disable
          const finalRows: ActionRowBuilder<ButtonBuilder>[] = [];
          for (let r = 0; r < 3; r++) {
            const row = new ActionRowBuilder<ButtonBuilder>();
            for (let c = 0; c < 3; c++) {
              const idx = r * 3 + c;
              const isWin = game.results[idx] === 'win';
              row.addComponents(
                new ButtonBuilder()
                  .setCustomId(`scratch_${interaction.user.id}_${idx}`)
                  .setLabel(isWin ? '💰' : '❌')
                  .setStyle(isWin ? ButtonStyle.Success : ButtonStyle.Danger)
                  .setDisabled(true)
              );
            }
            finalRows.push(row);
          }

          await i.update({ embeds: [loseEmbed], components: finalRows });
          scratchcardGames.delete(interaction.user.id);
          collector.stop();
          return;
        }

        await i.update({ embeds: [embed], components: newRows });
      }));

      collector.on('end', () => {
        scratchcardGames.delete(interaction.user.id);
        message.edit({ components: [] }).catch(() => {});
      });
    } catch (error) {
      console.error('Error in scratchcard command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while playing scratchcard.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
