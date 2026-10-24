import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, AttachmentBuilder } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import { withGameLock } from '../../services/game-lock.ts';
import prisma from '../../database/client.ts';




const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PNG_DIR = path.resolve(__dirname, '../../../PNG');




interface Card {
  suit: string;
  value: string;
  numericValue: number;
}

interface BlackjackGame {
  userId: string;
  channelId: string;
  messageId: string;
  bet: number;
  playerHand: Card[];
  playerHands: Card[][];
  handBets: number[];
  handStatuses: Array<'playing' | 'stand' | 'bust'>;
  activeHandIndex: number;
  split: boolean;
  dealerHand: Card[];
  deck: Card[];
  gameActive: boolean;
  doubledDown: boolean;
}

const blackjackGames = new Map<string, BlackjackGame>();

const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];


function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      let numericValue: number;
      if (value === 'A') {
        numericValue = 11;
      } else if (['J', 'Q', 'K'].includes(value)) {
        numericValue = 10;
      } else {
        numericValue = parseInt(value);
      }
      deck.push({ suit, value, numericValue });
    }
  }
  return shuffleDeck(deck);
}

function shuffleDeck(deck: Card[]): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function calculateHand(hand: Card[]): number {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += card.numericValue;
    if (card.value === 'A') aces++;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function getCardKey(card: Card): string {
  const suitMap: Record<string, string> = {
    '♠': 'S',
    '♥': 'H',
    '♦': 'D',
    '♣': 'C',
  };

  return `${card.value}${suitMap[card.suit]}`;
}

function currentHand(game: BlackjackGame): Card[] {
  return game.split ? game.playerHands[game.activeHandIndex] : game.playerHand;
}

function canSplit(game: BlackjackGame): boolean {
  const hand = game.playerHand;
  return !game.split &&
    hand.length === 2 &&
    hand[0].numericValue === hand[1].numericValue;
}

function advanceSplitHand(game: BlackjackGame): boolean {
  if (!game.split) return false;
  const next = game.handStatuses.findIndex((status, index) => index > game.activeHandIndex && status === 'playing');
  if (next === -1) return false;
  game.activeHandIndex = next;
  game.doubledDown = false;
  return true;
}


async function createBlackjackImage(
  dealerHand: Card[],
  playerHand: Card[],
  hideDealerCard: boolean
): Promise<Buffer> {
  const CARD_WIDTH = 70;
  const CARD_HEIGHT = 102;
  const GAP = 5;
  const PADDING = 10;


  const dealerKeys = dealerHand.map((card, index) => {
    if (hideDealerCard && index === 1) {
      return 'blue_back';
    }

    return getCardKey(card);
  });

  const playerKeys = playerHand.map(getCardKey);

  const dealerWidth =
    dealerKeys.length * CARD_WIDTH +
    Math.max(0, dealerKeys.length - 1) * GAP;

  const playerWidth =
    playerKeys.length * CARD_WIDTH +
    Math.max(0, playerKeys.length - 1) * GAP;

  const width = Math.max(dealerWidth, playerWidth) + PADDING * 2;

  const sectionGap = 20;
  const height = CARD_HEIGHT * 2 + sectionGap + PADDING * 2;

  const cardImages: {
    input: Buffer;
    left: number;
    top: number;
  }[] = [];

  // Dealer cards
  for (let i = 0; i < dealerKeys.length; i++) {
    const key = dealerKeys[i];

    const image = await sharp(
      path.join(PNG_DIR, `${key}.png`)
    )
      .resize(CARD_WIDTH, CARD_HEIGHT)
      .png()
      .toBuffer();

    cardImages.push({
      input: image,
      left: PADDING + i * (CARD_WIDTH + GAP),
      top: PADDING,
    });
  }

  // Player cards
  const playerTop = PADDING + CARD_HEIGHT + sectionGap;

  for (let i = 0; i < playerKeys.length; i++) {
    const key = playerKeys[i];

    const image = await sharp(
      path.join(PNG_DIR, `${key}.png`)
    )
      .resize(CARD_WIDTH, CARD_HEIGHT)
      .png()
      .toBuffer();

    cardImages.push({
      input: image,
      left: PADDING + i * (CARD_WIDTH + GAP),
      top: playerTop,
    });
  }

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {
        r: 30,
        g: 30,
        b: 30,
        alpha: 1,
      },
    },
  })
    .composite(cardImages)
    .png()
    .toBuffer();
}


export default {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play a game of blackjack')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Amount to bet')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const amount = interaction.options.getInteger('amount', true);
      const userId = interaction.user.id;

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(userId, 'blackjack');
      if (cooldown !== null) {
        const embed = EmbedService.error(
          'Cooldown Active',
          `You can play blackjack again in ${cooldown}`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Check if user has agreed to blackjack rules
      const user = await prisma.user.findUnique({
        where: { discordId: userId },
        include: { economyAccount: true }
      });

      if (!user?.economyAccount?.blackjackRulesAgreed) {
        const rulesEmbed = EmbedService.economy(
          '🃏 Blackjack Rules',
          `**Please read and agree to the rules before playing:**\n\n` +
          `• Goal: Get closer to 21 than the dealer without going over\n` +
          `• Card values: Number cards = face value, Face cards (J,Q,K) = 10, Ace = 1 or 11\n` +
          `• Hit: Take another card\n` +
          `• Stand: Keep your current hand\n` +
          `• Double: Double your bet and take exactly one more card\n` +
          `• Blackjack (Ace + 10-value card) pays 1.5x\n` +
          `• Dealer must hit until 17 or higher\n\n` +
          `⚠️ **IMPORTANT:** This is only a game. Do not develop a gambling addiction. Play at your own risk.\n\n` +
          `By clicking "I Agree", you understand these rules and the risks.`
        );

        const agreeRow = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`bj_agree_${userId}`)
              .setLabel('I Agree')
              .setStyle(ButtonStyle.Success)
          );

        const message = await interaction.editReply({ embeds: [rulesEmbed], components: [agreeRow] });

        const collector = message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
        });

        collector.on('collect', async (i) => {
          if (i.user.id !== userId) {
            await i.reply({ content: 'This is not your interaction!', ephemeral: true });
            return;
          }

          if (i.customId === `bj_agree_${userId}`) {
            await prisma.economyAccount.upsert({
              where: { userId: user!.id },
              update: { blackjackRulesAgreed: true },
              create: {
                userId: user!.id,
                blackjackRulesAgreed: true,
              },
            });

            const successEmbed = EmbedService.success('Rules Accepted', 'You have agreed to the blackjack rules. You can now play!');
            await i.update({ embeds: [successEmbed], components: [] });
          }
        });

        collector.on('end', async () => {
          try {
            const msg = await interaction.channel?.messages.fetch(message.id);
            if (msg) {
              await msg.edit({ components: [] });
            }
          } catch (error) {
            console.error('Error cleaning up rules message:', error);
          }
        });

        return;
      }

      // Check balance
      const balance = await EconomyService.getBalance(userId);
      if (balance.wallet < amount) {
        const embed = EmbedService.error(
          'Insufficient Funds',
          `You need ${amount} credits to play. You have ${balance.wallet} credits.`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Reserve the bet
      await EconomyService.removeCredits(userId, amount, 'Blackjack bet', 'BLACKJACK');

      // Create game
      const deck = createDeck();
      const playerHand = [deck.pop()!, deck.pop()!];
      const dealerHand = [deck.pop()!, deck.pop()!];

      const gameId = `${userId}-${Date.now()}`;
      const game: BlackjackGame = {
        userId,
        channelId: interaction.channelId,
        messageId: '',
        bet: amount,
        playerHand,
        playerHands: [playerHand],
        handBets: [amount],
        handStatuses: ['playing'],
        activeHandIndex: 0,
        split: false,
        dealerHand,
        deck,
        gameActive: true,
        doubledDown: false,
      };

      // Check for blackjack
      const playerTotal = calculateHand(playerHand);

      const imageBuffer = await createBlackjackImage(
        dealerHand,
        playerHand,
        true
      );

      const attachment = new AttachmentBuilder(imageBuffer, {
        name: 'blackjack.png',
      });


      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`bj_hit_${gameId}`)
            .setLabel('Hit')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`bj_stand_${gameId}`)
            .setLabel('Stand')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`bj_double_${gameId}`)
            .setLabel('Double')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`bj_split_${gameId}`)
            .setLabel('Split')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!canSplit(game))
        );

      const message = await interaction.editReply({
        content:
          `🃏 **Blackjack**\n\n` +
          `**Your Hand:** ${playerTotal}\n` +
          `**Bet:** ${amount} credits`,
        files: [attachment],
        components: [row],
      });

      game.messageId = message.id;
      blackjackGames.set(gameId, game);

      // Set cooldown
      const serverConfig = await prisma.serverConfig.findUnique({
        where: {
          guildId: interaction.guildId!,
        },
      });

      const blackjackCooldown =
        serverConfig?.blackjackCooldown ?? config.blackjackCooldown;
      
      console.log(
        `[blackjack] Server cooldown: ${serverConfig?.blackjackCooldown}ms | ` +
        `Using: ${blackjackCooldown}ms`
      );

      if (blackjackCooldown > 0) {
        await CooldownService.setCooldown(
          userId,
          'blackjack',
          blackjackCooldown
        );
      }


      // Check for instant blackjack
      if (playerTotal === 21) {
        await endGame(gameId, 'blackjack', interaction.client);
      }

      // Create button collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on('collect', (i) => withGameLock(gameId, i, async () => {
        if (i.user.id !== userId) {
          await i.reply({ content: 'This is not your game!', ephemeral: true });
          return;
        }

        const currentGame = blackjackGames.get(gameId);
        if (!currentGame || !currentGame.gameActive) {
          await i.reply({ content: 'This game has ended.', ephemeral: true });
          return;
        }

        await i.deferUpdate();

        if (i.customId === `bj_hit_${gameId}`) {
          currentHand(currentGame).push(currentGame.deck.pop()!);
          const newTotal = calculateHand(currentHand(currentGame));

          if (newTotal > 21) {
            if (currentGame.split) {
              currentGame.handStatuses[currentGame.activeHandIndex] = 'bust';
              if (!advanceSplitHand(currentGame)) await endGame(gameId, 'stand', interaction.client);
              else await updateGameDisplay(gameId, interaction.client);
            } else {
              await endGame(gameId, 'bust', interaction.client);
            }
          } else if (newTotal === 21) {
            await endGame(gameId, 'stand', interaction.client);
          } else {
            await updateGameDisplay(gameId, interaction.client);
          }
        } else if (i.customId === `bj_stand_${gameId}`) {
          if (currentGame.split) {
            currentGame.handStatuses[currentGame.activeHandIndex] = 'stand';
            if (!advanceSplitHand(currentGame)) await endGame(gameId, 'stand', interaction.client);
            else await updateGameDisplay(gameId, interaction.client);
          } else {
            await endGame(gameId, 'stand', interaction.client);
          }
        } else if (i.customId === `bj_split_${gameId}`) {
          if (!canSplit(currentGame)) {
            await i.followUp({ content: 'You can only split your initial matching pair.', ephemeral: true });
            return;
          }
          const currentBalance = await EconomyService.getBalance(userId);
          if (currentBalance.wallet < amount) {
            await i.followUp({ content: 'Not enough credits to split.', ephemeral: true });
            return;
          }
          await EconomyService.removeCredits(userId, amount, 'Blackjack split', 'BLACKJACK');
          const [first, second] = currentGame.playerHand;
          currentGame.playerHands = [[first, currentGame.deck.pop()!], [second, currentGame.deck.pop()!]];
          currentGame.handBets = [currentGame.bet, currentGame.bet];
          currentGame.handStatuses = ['playing', 'playing'];
          currentGame.activeHandIndex = 0;
          currentGame.split = true;
          currentGame.doubledDown = false;
          await updateGameDisplay(gameId, interaction.client);
        } else if (i.customId === `bj_double_${gameId}`) {
          if (currentGame.doubledDown) {
            await i.reply({ content: 'You can only double once!', ephemeral: true });
            return;
          }

          // Check if user has enough for double
          const currentBalance = await EconomyService.getBalance(userId);
          if (currentBalance.wallet < amount) {
            await i.reply({ content: 'Not enough credits to double!', ephemeral: true });
            return;
          }

          await EconomyService.removeCredits(userId, amount, 'Blackjack double', 'BLACKJACK');
          if (currentGame.split) {
            currentGame.handBets[currentGame.activeHandIndex] *= 2;
          } else {
            currentGame.bet *= 2;
          }
          currentGame.doubledDown = true;
          currentHand(currentGame).push(currentGame.deck.pop()!);

          const newTotal = calculateHand(currentHand(currentGame));
          if (newTotal > 21) {
            if (currentGame.split) {
              currentGame.handStatuses[currentGame.activeHandIndex] = 'bust';
              if (!advanceSplitHand(currentGame)) await endGame(gameId, 'stand', interaction.client);
              else await updateGameDisplay(gameId, interaction.client);
            } else {
              await endGame(gameId, 'bust', interaction.client);
            }
          } else {
            if (currentGame.split) {
              currentGame.handStatuses[currentGame.activeHandIndex] = 'stand';
              if (!advanceSplitHand(currentGame)) await endGame(gameId, 'stand', interaction.client);
              else await updateGameDisplay(gameId, interaction.client);
            } else {
              await endGame(gameId, 'stand', interaction.client);
            }
          }
        }

      }));

      collector.on('end', async () => {
        const currentGame = blackjackGames.get(gameId);
        if (currentGame && currentGame.gameActive) {
          await endGame(gameId, 'timeout', interaction.client);
        }
      });
    } catch (error) {
      console.error('Error in blackjack command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while starting the game.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

async function updateGameDisplay(gameId: string, client: any) {
  const game = blackjackGames.get(gameId);
  if (!game) return;

  const hand = currentHand(game);
  const playerTotal = calculateHand(hand);

  try {
    const imageBuffer = await createBlackjackImage(
      game.dealerHand,
      hand,
      true
    );

    const attachment = new AttachmentBuilder(imageBuffer, {
      name: 'blackjack.png',
    });

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`bj_hit_${gameId}`)
          .setLabel('Hit')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId(`bj_stand_${gameId}`)
          .setLabel('Stand')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(`bj_double_${gameId}`)
          .setLabel('Double')
          .setStyle(ButtonStyle.Success)
          .setDisabled(game.doubledDown)
          ,
        new ButtonBuilder()
          .setCustomId(`bj_split_${gameId}`)
          .setLabel('Split')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!canSplit(game))
      );

    const channel = await client.channels.fetch(game.channelId);

    if (channel && 'messages' in channel) {
      const message = await channel.messages.fetch(game.messageId);

      await message.edit({
        content:
          `🃏 **Blackjack**\n\n` +
          `**Your Hand:** ${playerTotal}\n` +
            `**Bet:** ${game.split ? game.handBets[game.activeHandIndex] : game.bet} credits` +
            (game.split ? `\n**Hand:** ${game.activeHandIndex + 1}/2` : ''),
        files: [attachment],
        components: [row],
      });
    }
  } catch (error) {
    console.error('Error updating blackjack display:', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function endGame(gameId: string, result: string, client: any) {
  const game = blackjackGames.get(gameId);
  if (!game) return;

  game.gameActive = false;

  let winnings = 0;
  let resultText = '';

  const playerTotal = calculateHand(currentHand(game));

  // Get the Discord message once
  let message: any;

  try {
    const channel = await client.channels.fetch(game.channelId);

    if (channel && 'messages' in channel) {
      message = await channel.messages.fetch(game.messageId);
    }
  } catch (error) {
    console.error('Error fetching blackjack message:', error);
    return;
  }

  /*
   * ========================================
   * DEALER DRAWING ANIMATION
   * ========================================
   */

  let dealerTotal = calculateHand(game.dealerHand);

  // Reveal dealer's starting hand first
  try {
    const imageBuffer = await createBlackjackImage(
      game.dealerHand,
      currentHand(game),
      false
    );

    const attachment = new AttachmentBuilder(imageBuffer, {
      name: 'blackjack.png',
    });

    await message.edit({
      content:
        `🃏 **Blackjack**\n\n` +
        `**Dealer:** ${dealerTotal}\n` +
        `**You:** ${playerTotal}\n\n` +
        `Dealer is thinking...`,
      files: [attachment],
      components: [],
    });
  } catch (error) {
    console.error('Error revealing dealer hand:', error);
  }

  // Give the player time to see the dealer's hand
  await sleep(1500);

  // Dealer draws one card at a time
  while (
    dealerTotal < 17 &&
    result === 'stand' &&
    game.deck.length > 0
  ) {
    // Draw ONE card
    const drawnCard = game.deck.pop()!;
    game.dealerHand.push(drawnCard);

    dealerTotal = calculateHand(game.dealerHand);

    // Generate the image AFTER drawing the card
    const imageBuffer = await createBlackjackImage(
      game.dealerHand,
      currentHand(game),
      false
    );

    const attachment = new AttachmentBuilder(imageBuffer, {
      name: 'blackjack.png',
    });

    // Show the newly drawn card
    await message.edit({
      content:
        `🃏 **Blackjack**\n\n` +
        `**Dealer:** ${dealerTotal}\n` +
        `**You:** ${playerTotal}\n\n` +
        `Dealer drew a card...`,
      files: [attachment],
      components: [],
    });

    // WAIT AFTER THE EDIT
    // This is what makes each card visibly appear one at a time.
    if (dealerTotal < 17) {
      await sleep(1500);
    }
  }

  const finalDealerTotal = calculateHand(game.dealerHand);

  // Small pause before announcing the result
  await sleep(1200);

  /*
   * ========================================
   * DETERMINE RESULT
   * ========================================
   */

  if (game.split) {
    const handResults = game.playerHands.map((hand, index) => {
      const total = calculateHand(hand);
      const bet = game.handBets[index];
      if (total > 21) return { text: `Hand ${index + 1} busted`, winnings: 0 };
      if (finalDealerTotal > 21 || total > finalDealerTotal) return { text: `Hand ${index + 1} won`, winnings: bet * 2 };
      if (total === finalDealerTotal) return { text: `Hand ${index + 1} pushed`, winnings: bet };
      return { text: `Hand ${index + 1} lost`, winnings: 0 };
    });
    resultText = handResults.map(hand => hand.text).join(' • ');
    winnings = handResults.reduce((total, hand) => total + hand.winnings, 0);
  } else if (result === 'bust') {
    resultText = '💥 You busted!';
    winnings = 0;

  } else if (result === 'timeout') {
    resultText = '⏰ Game timed out!';
    winnings = 0;

  } else if (result === 'blackjack') {
    resultText = '🎉 BLACKJACK! You win 1.5x your bet!';
    winnings = Math.floor(game.bet * 2.5);

  } else {
    if (finalDealerTotal > 21) {
      resultText = '🎉 Dealer busted! You win!';
      winnings = game.bet * 2;

    } else if (playerTotal > finalDealerTotal) {
      resultText = '🎉 You win!';
      winnings = game.bet * 2;

    } else if (playerTotal < finalDealerTotal) {
      resultText = '😢 Dealer wins!';
      winnings = 0;

    } else {
      resultText = '🤝 Push! Bet returned.';
      winnings = game.bet;
    }
  }

  /*
   * ========================================
   * PAY WINNINGS
   * ========================================
   */

  if (winnings > 0) {
    await EconomyService.addCredits(
      game.userId,
      winnings,
      'Blackjack win',
      'BLACKJACK'
    );
  }

  /*
   * ========================================
   * FINAL IMAGE
   * ========================================
   */

  const imageBuffer = await createBlackjackImage(
    game.dealerHand,
    currentHand(game),
    false
  );

  const attachment = new AttachmentBuilder(imageBuffer, {
    name: 'blackjack.png',
  });

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_hit_${gameId}`)
        .setLabel('Hit')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),

      new ButtonBuilder()
        .setCustomId(`bj_stand_${gameId}`)
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),

      new ButtonBuilder()
        .setCustomId(`bj_double_${gameId}`)
        .setLabel('Double')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );

  /*
   * ========================================
   * FINAL RESULT
   * ========================================
   */

  try {
    await message.edit({
      content:
        `🃏 **Blackjack - Game Over**\n\n` +
        `**Dealer:** ${finalDealerTotal}\n` +
        `${game.split
          ? game.playerHands.map((hand, index) => `**Hand ${index + 1}:** ${calculateHand(hand)}`).join('\n')
          : `**You:** ${playerTotal}`}\n\n` +
        `**${resultText}**\n` +
        `**Bet:** ${game.split ? game.handBets.reduce((total, bet) => total + bet, 0) : game.bet} credits\n` +
        `**Winnings:** ${winnings} credits`,
      files: [attachment],
      components: [row],
    });

  } catch (error) {
    console.error('Error updating game end display:', error);
  }

  blackjackGames.delete(gameId);
}
