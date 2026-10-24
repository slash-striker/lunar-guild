import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import { withGameLock } from '../../services/game-lock.ts';

interface MatchPairsGame {
  userId: string;
  channelId: string;
  messageId: string;
  tiles: string[];
  revealed: boolean[];
  matched: boolean[];
  lives: number;
  gameActive: boolean;
}

const matchPairsGames = new Map<string, MatchPairsGame>();

const FOOD_EMOJIS = ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒'];

function createTiles(): string[] {
  const pairs = [...FOOD_EMOJIS, ...FOOD_EMOJIS];
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs;
}

export default {
  data: new SlashCommandBuilder()
    .setName('matchpairs')
    .setDescription('Play a match pairs memory game'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const userId = interaction.user.id;

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(userId, 'matchpairs');
      if (cooldown !== null) {
        const embed = EmbedService.error(
          'Cooldown Active',
          `You can play match pairs again in ${cooldown}`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Create game
      const gameId = `${userId}-${Date.now()}`;
      const tiles = createTiles();
      const game: MatchPairsGame = {
        userId,
        channelId: interaction.channelId,
        messageId: '',
        tiles,
        revealed: new Array(20).fill(false),
        matched: new Array(20).fill(false),
        lives: 12,
        gameActive: true,
      };

      const embed = EmbedService.economy(
        '🎮 Match Pairs',
        `Find all matching pairs! You have ${game.lives} lives.\n\nClick tiles to reveal them.`
      )
        .setFooter({ text: `Game ID: ${gameId}` })
        .setTimestamp();

      const rows = createButtonRows(game, gameId);

      const message = await interaction.editReply({ embeds: [embed], components: rows });
      game.messageId = message.id;
      matchPairsGames.set(gameId, game);

      // Set cooldown
      await CooldownService.setCooldown(userId, 'matchpairs');

      // Create button collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000, // 5 minutes
      });

      let firstSelection: number | null = null;
      let secondSelection: number | null = null;

      collector.on('collect', (i) => withGameLock(gameId, i, async () => {
        if (i.user.id !== userId) {
          await i.reply({ content: 'This is not your game!', ephemeral: true });
          return;
        }

        const currentGame = matchPairsGames.get(gameId);
        if (!currentGame || !currentGame.gameActive) {
          await i.reply({ content: 'This game has ended.', ephemeral: true });
          return;
        }

        if (i.customId === `mp_quit_${gameId}`) {
          await endGame(gameId, 'quit', i.client);
          await i.update({});
          return;
        }

        const tileIndex = parseInt(i.customId.split('_')[2]);

        if (currentGame.revealed[tileIndex] || currentGame.matched[tileIndex]) {
          await i.reply({ content: 'This tile is already revealed or matched!', ephemeral: true });
          return;
        }

        if (firstSelection === null) {
          firstSelection = tileIndex;
          currentGame.revealed[tileIndex] = true;
          await updateGameDisplay(gameId, i.client);
          await i.update({});
        } else if (secondSelection === null) {
          secondSelection = tileIndex;
          currentGame.revealed[tileIndex] = true;

          if (currentGame.tiles[firstSelection] === currentGame.tiles[secondSelection]) {
            // Match found
            currentGame.matched[firstSelection] = true;
            currentGame.matched[secondSelection] = true;
            firstSelection = null;
            secondSelection = null;

            // Check if all pairs matched
            if (currentGame.matched.every(m => m)) {
              await endGame(gameId, 'win', i.client);
            } else {
              await updateGameDisplay(gameId, i.client);
              await i.update({});
            }
          } else {
            // No match
            currentGame.lives--;
            await updateGameDisplay(gameId, i.client);
            await i.update({});

            // Hide tiles after delay
            setTimeout(async () => {
              const updatedGame = matchPairsGames.get(gameId);
              if (updatedGame && updatedGame.gameActive) {
                updatedGame.revealed[firstSelection!] = false;
                updatedGame.revealed[secondSelection!] = false;
                firstSelection = null;
                secondSelection = null;

                if (updatedGame.lives <= 0) {
                  await endGame(gameId, 'lose', i.client);
                } else {
                  await updateGameDisplay(gameId, i.client);
                }
              }
            }, 1000);
          }
        }
      }));

      collector.on('end', async () => {
        const currentGame = matchPairsGames.get(gameId);
        if (currentGame && currentGame.gameActive) {
          await endGame(gameId, 'timeout', interaction.client);
        }
      });
    } catch (error) {
      console.error('Error in matchpairs command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while starting the game.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

function createButtonRows(game: MatchPairsGame, gameId: string): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let row = 0; row < 4; row++) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    for (let col = 0; col < 5; col++) {
      const index = row * 5 + col;
      const button = new ButtonBuilder()
        .setCustomId(`mp_${gameId}_${index}`)
        .setLabel(game.revealed[index] || game.matched[index] ? game.tiles[index] : '?')
        .setStyle(game.matched[index] ? ButtonStyle.Success : game.revealed[index] ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(game.matched[index] || !game.gameActive);
      actionRow.addComponents(button);
    }
    rows.push(actionRow);
  }

  // Add quit button row
  const quitRow = new ActionRowBuilder<ButtonBuilder>();
  quitRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`mp_quit_${gameId}`)
      .setLabel('🚪 Quit')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!game.gameActive)
  );
  rows.push(quitRow);

  return rows;
}

async function updateGameDisplay(gameId: string, client: any) {
  const game = matchPairsGames.get(gameId);
  if (!game) return;

  const matchedCount = game.matched.filter(m => m).length / 2;
  let description = `Find all matching pairs! You have ${game.lives} lives.\n`;
  description += `Pairs matched: ${matchedCount}/10\n\nClick tiles to reveal them.`;

  const embed = EmbedService.economy('🎮 Match Pairs', description)
    .setFooter({ text: `Game ID: ${gameId}` })
    .setTimestamp();

  const rows = createButtonRows(game, gameId);

  try {
    const channel = await client.channels.fetch(game.channelId);
    if (channel && 'messages' in channel) {
      const message = await channel.messages.fetch(game.messageId);
      await message.edit({ embeds: [embed], components: rows });
    }
  } catch (error) {
    console.error('Error updating match pairs display:', error);
  }
}

async function endGame(gameId: string, result: string, client: any) {
  const game = matchPairsGames.get(gameId);
  if (!game) return;

  game.gameActive = false;

  let description = '';
  const reward = 500; // Configurable reward

  if (result === 'win') {
    description = '🎉 You matched all pairs! You win 500 credits!';
    await EconomyService.addCredits(game.userId, reward, 'Match pairs win', 'MATCH_PAIRS');
  } else if (result === 'lose') {
    description = '😢 You ran out of lives! Better luck next time.';
  } else if (result === 'timeout') {
    description = '⏰ Game timed out!';
  } else if (result === 'quit') {
    description = '🚪 You quit the game.';
  }

  const embed = EmbedService.economy('🎮 Match Pairs - Game Over', description)
    .setFooter({ text: `Game ID: ${gameId}` })
    .setTimestamp();

  const rows = createButtonRows(game, gameId);

  try {
    const channel = await client.channels.fetch(game.channelId);
    if (channel && 'messages' in channel) {
      const message = await channel.messages.fetch(game.messageId);
      await message.edit({ embeds: [embed], components: rows });
    }
  } catch (error) {
    console.error('Error updating match pairs end display:', error);
  }

  matchPairsGames.delete(gameId);
}
