import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  ButtonInteraction,
  Message,
  Client,
  ClientApplication,
  InteractionCollector,
} from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

interface PlayerStats {
  roundsPlayed: number;
  roundsWon: number;
  gamesPlayed: number;
  gamesWon: number;
  totalWinnings: number;
  highestPayout: number;
  currentStreak: number;
  bestStreak: number;
  luckyRounds: number;
  mysteryMultipliers: number;
  twoXMultipliers: number;
  pvpGames: number;
  pvpWins: number;
  progressionXP: number;
  level: number;
  achievements: Set<string>;
}

interface HighLowGame {
  gameId: string;
  userId: string;
  channelId: string;
  messageId: string;

  firstNumber: number;
  secondNumber: number;

  bet: number;
  originalBet: number;

  round: number;
  maxRounds: number;

  totalPayout: number;
  currentRoundWon: boolean;

  gameActive: boolean;
  processing: boolean;
  mode: 'solo' | 'pvp';
  preset: GamePreset;

  opponentId?: string;
  opponentGameId?: string;

  lastChoice?: Choice;
  lastMultiplier?: number;
  lastMultiplierType?: MultiplierType;
}

type Choice = 'higher' | 'lower' | 'same';

type GamePreset = 'safe' | 'classic' | 'aggressive';

type MultiplierType =
  | 'normal'
  | 'two_x'
  | 'mystery'
  | 'lucky';

interface PvPMatch {
  gameId: string;
  userId: string;
  bet: number;
  preset: GamePreset;
  channelId: string;
  messageId: string;
}

const highLowGames = new Map<string, HighLowGame>();
const highLowLocks = new Set<string>();

async function withHighLowLock<T>(gameId: string, interaction: ButtonInteraction, action: () => Promise<T>): Promise<T | undefined> {
  if (highLowLocks.has(gameId)) {
    await interaction.reply({ content: 'Please wait for the previous action to finish.', ephemeral: true });
    return undefined;
  }
  highLowLocks.add(gameId);
  try { return await action(); } finally { highLowLocks.delete(gameId); }
}

const playerStats = new Map<string, PlayerStats>();

export async function resetHighLowStats(userId: string): Promise<void> {
  playerStats.delete(userId);

  for (const [gameId, game] of highLowGames) {
    if (game.userId === userId || game.opponentId === userId) {
      game.gameActive = false;
      highLowGames.delete(gameId);
    }
  }

  await prisma.highLowStats.deleteMany({ where: { userId } });
}

/**
 * PvP matchmaking queue.
 *
 * Players are matched by:
 * - bet
 * - preset
 */
const pvpQueue = new Map<string, PvPMatch>();

const MAX_ROUNDS = 5;
const TIMEOUT_MS = 300_000;

/**
 * Transparent multiplier probabilities.
 *
 * These are intentionally explicit and total 100%.
 */
const MULTIPLIER_PROBABILITIES = {
  normal: 75,
  twoX: 15,
  mystery: 8,
  lucky: 2,
} as const;

/**
 * Mystery multiplier probabilities.
 *
 * These are shown to the player when the mystery multiplier resolves.
 */
const MYSTERY_MULTIPLIERS = [
  { multiplier: 2, probability: 40 },
  { multiplier: 2.5, probability: 30 },
  { multiplier: 3, probability: 20 },
  { multiplier: 5, probability: 10 },
] as const;

const ACHIEVEMENTS = {
  FIRST_WIN: 'First Win',
  TEN_WINS: '10 Wins',
  FIFTY_ROUNDS: '50 Rounds',
  LUCKY_PLAYER: 'Lucky Player',
  MYSTERY_HUNTER: 'Mystery Hunter',
  TWO_X_CLUB: '2X Club',
  HOT_STREAK: 'Hot Streak',
  BIG_WINNER: 'Big Winner',
  PVP_CHAMPION: 'PvP Champion',
  LEVEL_FIVE: 'Level 5',
} as const;

function generateNumber(): number {
  return Math.floor(Math.random() * 100) + 1;
}

function getOrCreateStats(userId: string): PlayerStats {
  let stats = playerStats.get(userId);

  if (!stats) {
    stats = {
      roundsPlayed: 0,
      roundsWon: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      totalWinnings: 0,
      highestPayout: 0,
      currentStreak: 0,
      bestStreak: 0,
      luckyRounds: 0,
      mysteryMultipliers: 0,
      twoXMultipliers: 0,
      pvpGames: 0,
      pvpWins: 0,
      progressionXP: 0,
      level: 1,
      achievements: new Set<string>(),
    };

    playerStats.set(userId, stats);
  }

  return stats;
}

async function loadStats(userId: string, guildId: string): Promise<PlayerStats> {
    await prisma.user.upsert({
      where: { discordId: userId },
      update: {},
      create: { discordId: userId, guildId },
    });
    const stored = await prisma.highLowStats.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const stats: PlayerStats = {
      roundsPlayed: stored.roundsPlayed, roundsWon: stored.roundsWon,
      gamesPlayed: stored.gamesPlayed, gamesWon: stored.gamesWon,
      totalWinnings: stored.totalWinnings, highestPayout: stored.highestPayout,
      currentStreak: stored.currentStreak, bestStreak: stored.bestStreak,
      luckyRounds: stored.luckyRounds, mysteryMultipliers: stored.mysteryMultipliers,
      twoXMultipliers: stored.twoXMultipliers, pvpGames: stored.pvpGames,
      pvpWins: stored.pvpWins, progressionXP: stored.progressionXP,
      level: stored.level, achievements: new Set<string>(JSON.parse(stored.achievements || '[]')),
    };
    playerStats.set(userId, stats);
    return stats;
  }

async function saveStats(userId: string): Promise<void> {
    const stats = getOrCreateStats(userId);
    await prisma.highLowStats.upsert({
      where: { userId },
      update: {
        roundsPlayed: stats.roundsPlayed, roundsWon: stats.roundsWon,
        gamesPlayed: stats.gamesPlayed, gamesWon: stats.gamesWon,
        totalWinnings: stats.totalWinnings, highestPayout: stats.highestPayout,
        currentStreak: stats.currentStreak, bestStreak: stats.bestStreak,
        luckyRounds: stats.luckyRounds, mysteryMultipliers: stats.mysteryMultipliers,
        twoXMultipliers: stats.twoXMultipliers, pvpGames: stats.pvpGames,
        pvpWins: stats.pvpWins, progressionXP: stats.progressionXP,
        level: stats.level, achievements: JSON.stringify([...stats.achievements]),
      },
      create: {
        userId, roundsPlayed: stats.roundsPlayed, roundsWon: stats.roundsWon,
        gamesPlayed: stats.gamesPlayed, gamesWon: stats.gamesWon,
        totalWinnings: stats.totalWinnings, highestPayout: stats.highestPayout,
        currentStreak: stats.currentStreak, bestStreak: stats.bestStreak,
        luckyRounds: stats.luckyRounds, mysteryMultipliers: stats.mysteryMultipliers,
        twoXMultipliers: stats.twoXMultipliers, pvpGames: stats.pvpGames,
        pvpWins: stats.pvpWins, progressionXP: stats.progressionXP,
        level: stats.level, achievements: JSON.stringify([...stats.achievements]),
      },
    });
  }

function addXP(userId: string, amount: number): void {
  const stats = getOrCreateStats(userId);

  stats.progressionXP += amount;

  while (stats.progressionXP >= xpRequiredForLevel(stats.level + 1)) {
    stats.level++;
  }

  updateAchievements(userId);
}

function xpRequiredForLevel(level: number): number {
  return 100 + (level - 1) * 100;
}

function getPresetDescription(preset: GamePreset): string {
  switch (preset) {
    case 'safe':
      return 'Safer mode: Same pays less, but the overall round variance is reduced.';
    case 'aggressive':
      return 'Aggressive mode: higher Same payout and more volatile results.';
    case 'classic':
    default:
      return 'Classic High/Low balance.';
  }
}

function getSameMultiplier(preset: GamePreset): number {
  switch (preset) {
    case 'safe':
      return 3;
    case 'aggressive':
      return 7;
    case 'classic':
    default:
      return 5;
  }
}

function rollMultiplier(): {
  type: MultiplierType;
  multiplier: number;
} {
  const roll = Math.random() * 100;

  if (roll < MULTIPLIER_PROBABILITIES.lucky) {
    return {
      type: 'lucky',
      multiplier: 3,
    };
  }

  if (
    roll <
    MULTIPLIER_PROBABILITIES.lucky +
      MULTIPLIER_PROBABILITIES.mystery
  ) {
    return {
      type: 'mystery',
      multiplier: rollMysteryMultiplier(),
    };
  }

  if (
    roll <
    MULTIPLIER_PROBABILITIES.lucky +
      MULTIPLIER_PROBABILITIES.mystery +
      MULTIPLIER_PROBABILITIES.twoX
  ) {
    return {
      type: 'two_x',
      multiplier: 2,
    };
  }

  return {
    type: 'normal',
    multiplier: 1,
  };
}

function rollMysteryMultiplier(): number {
  const roll = Math.random() * 100;

  let cumulative = 0;

  for (const entry of MYSTERY_MULTIPLIERS) {
    cumulative += entry.probability;

    if (roll < cumulative) {
      return entry.multiplier;
    }
  }

  return 2;
}

function getMultiplierLabel(
  type: MultiplierType,
  multiplier: number
): string {
  switch (type) {
    case 'two_x':
      return `⚡ **2× Multiplier**`;
    case 'mystery':
      return `❓ **Mystery Multiplier: ${multiplier}×**`;
    case 'lucky':
      return `🍀 **LUCKY ROUND: ${multiplier}×**`;
    default:
      return `Multiplier: **${multiplier}×**`;
  }
}

function updateAchievements(userId: string): void {
  const stats = getOrCreateStats(userId);

  if (stats.gamesWon >= 1) {
    stats.achievements.add(ACHIEVEMENTS.FIRST_WIN);
  }

  if (stats.gamesWon >= 10) {
    stats.achievements.add(ACHIEVEMENTS.TEN_WINS);
  }

  if (stats.roundsPlayed >= 50) {
    stats.achievements.add(ACHIEVEMENTS.FIFTY_ROUNDS);
  }

  if (stats.luckyRounds >= 1) {
    stats.achievements.add(ACHIEVEMENTS.LUCKY_PLAYER);
  }

  if (stats.mysteryMultipliers >= 5) {
    stats.achievements.add(ACHIEVEMENTS.MYSTERY_HUNTER);
  }

  if (stats.twoXMultipliers >= 5) {
    stats.achievements.add(ACHIEVEMENTS.TWO_X_CLUB);
  }

  if (stats.bestStreak >= 5) {
    stats.achievements.add(ACHIEVEMENTS.HOT_STREAK);
  }

  if (stats.highestPayout >= 5000) {
    stats.achievements.add(ACHIEVEMENTS.BIG_WINNER);
  }

  if (stats.pvpWins >= 10) {
    stats.achievements.add(ACHIEVEMENTS.PVP_CHAMPION);
  }

  if (stats.level >= 5) {
    stats.achievements.add(ACHIEVEMENTS.LEVEL_FIVE);
  }
}

function recordRound(
  userId: string,
  won: boolean,
  payout: number
): void {
  const stats = getOrCreateStats(userId);

  stats.roundsPlayed++;

  if (won) {
    stats.roundsWon++;
    stats.currentStreak++;

    if (stats.currentStreak > stats.bestStreak) {
      stats.bestStreak = stats.currentStreak;
    }

    stats.totalWinnings += payout;

    if (payout > stats.highestPayout) {
      stats.highestPayout = payout;
    }

    addXP(userId, 25);
  } else {
    stats.currentStreak = 0;
    addXP(userId, 5);
  }

  updateAchievements(userId);
}

function recordMultiplier(
  userId: string,
  type: MultiplierType
): void {
  const stats = getOrCreateStats(userId);

  if (type === 'lucky') {
    stats.luckyRounds++;
  }

  if (type === 'mystery') {
    stats.mysteryMultipliers++;
  }

  if (type === 'two_x') {
    stats.twoXMultipliers++;
  }

  updateAchievements(userId);
}

function createStatsEmbed(userId: string) {
  const stats = getOrCreateStats(userId);

  const achievements =
    stats.achievements.size > 0
      ? [...stats.achievements]
          .map((achievement) => `🏆 ${achievement}`)
          .join('\n')
      : 'No achievements unlocked yet.';

  const nextLevelXP = xpRequiredForLevel(stats.level + 1);

  return EmbedService.economy(
    '📊 High/Low Stats & Achievements',
    [
      `**Level:** ${stats.level}`,
      `**XP:** ${stats.progressionXP}/${nextLevelXP}`,
      '',
      `**Games Played:** ${stats.gamesPlayed}`,
      `**Games Won:** ${stats.gamesWon}`,
      `**Rounds Played:** ${stats.roundsPlayed}`,
      `**Rounds Won:** ${stats.roundsWon}`,
      `**Win Rate:** ${
        stats.roundsPlayed > 0
          ? ((stats.roundsWon / stats.roundsPlayed) * 100).toFixed(1)
          : '0.0'
      }%`,
      '',
      `**Current Streak:** ${stats.currentStreak}`,
      `**Best Streak:** ${stats.bestStreak}`,
      `**Total Winnings:** ${stats.totalWinnings} credits`,
      `**Highest Payout:** ${stats.highestPayout} credits`,
      '',
      `**2× Events:** ${stats.twoXMultipliers}`,
      `**Mystery Events:** ${stats.mysteryMultipliers}`,
      `**Lucky Rounds:** ${stats.luckyRounds}`,
      '',
      `**PvP Games:** ${stats.pvpGames}`,
      `**PvP Wins:** ${stats.pvpWins}`,
      '',
      `### 🏆 Achievements`,
      achievements,
    ].join('\n')
  );
}

function createRulesEmbed() {
  return EmbedService.economy(
    '📋 High/Low Rules & Probabilities',
    [
      '**Rounds:** 5 per game',
      '',
      '**Base payouts**',
      '• Higher: 1.5×',
      '• Lower: 1.5×',
      '• Same: 5× (Classic)',
      '',
      '**Dynamic multiplier events — exact probabilities**',
      `• Normal: **${MULTIPLIER_PROBABILITIES.normal}%**`,
      `• 2× Multiplier: **${MULTIPLIER_PROBABILITIES.twoX}%**`,
      `• Mystery Multiplier: **${MULTIPLIER_PROBABILITIES.mystery}%**`,
      `• Lucky Round: **${MULTIPLIER_PROBABILITIES.lucky}%**`,
      '',
      '**Mystery multiplier probabilities**',
      ...MYSTERY_MULTIPLIERS.map(
        (entry) =>
          `• ${entry.multiplier}×: **${entry.probability}%**`
      ),
      '',
      '**Timeout:** 67% of the original bet is refunded.',
      '**Quit:** The current stake is forfeited.',
      '',
      '**PvP:** No house fee. The winner receives the opponent stake plus a 10% winner bonus.',
    ].join('\n')
  );
}

function createGameButtons(
  gameId: string,
  disabled = false
): ActionRowBuilder<ButtonBuilder>[] {
  const guessingRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`hl_higher_${gameId}`)
        .setLabel('Higher')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`hl_lower_${gameId}`)
        .setLabel('Lower')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`hl_same_${gameId}`)
        .setLabel('Same')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`hl_quit_${gameId}`)
        .setLabel('🚪 Quit')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    );

  const statsRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`hl_stats_${gameId}`)
        .setLabel('📊 Stats & Achievements')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),

      new ButtonBuilder()
        .setCustomId(`hl_rules_${gameId}`)
        .setLabel('📋 Rules & Odds')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );

  return [guessingRow, statsRow];
}

function createPresetButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('hl_preset_safe')
      .setLabel('Safe')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('hl_preset_classic')
      .setLabel('Classic')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('hl_preset_aggressive')
      .setLabel('Aggressive')
      .setStyle(ButtonStyle.Danger)
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('highlow')
    .setDescription('Play the multi-round High/Low guessing game')
    .addIntegerOption((option) =>
      option
        .setName('bet')
        .setDescription('Amount to bet')
        .setRequired(true)
        .setMinValue(10)
        .setMaxValue(1000)
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Solo or PvP')
        .setRequired(false)
        .addChoices(
          { name: 'Solo', value: 'solo' },
          { name: 'PvP', value: 'pvp' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('preset')
        .setDescription('Game preset')
        .setRequired(false)
        .addChoices(
          { name: 'Safe', value: 'safe' },
          { name: 'Classic', value: 'classic' },
          { name: 'Aggressive', value: 'aggressive' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const bet = interaction.options.getInteger('bet', true);
      const userId = interaction.user.id;
      await loadStats(userId, interaction.guildId!);

      const mode =
        (interaction.options.getString('mode') as 'solo' | 'pvp') ??
        'solo';

      const preset =
        (interaction.options.getString('preset') as GamePreset) ??
        'classic';

      const cooldown = await CooldownService.checkCooldown(
        userId,
        'highlow'
      );

      if (cooldown !== null) {
        const embed = EmbedService.error(
          'Cooldown Active',
          `You can play High/Low again in ${cooldown}`
        );

        return interaction.editReply({
          embeds: [embed],
        });
      }

      const balance = await EconomyService.getBalance(userId);

      if (balance.wallet < bet) {
        const embed = EmbedService.error(
          'Insufficient Funds',
          `You need ${bet} credits to play. You have ${balance.wallet} credits.`
        );

        return interaction.editReply({
          embeds: [embed],
        });
      }

      /**
       * Reserve the player's stake immediately.
       */
      await EconomyService.removeCredits(
        userId,
        bet,
        'High/Low bet',
        'HIGH_LOW'
      );

      const gameId = `${userId}-${Date.now()}`;

      /**
       * PvP mode:
       *
       * Look for an existing player with the same bet/preset.
       * If found, start the match.
       * Otherwise place this player into the queue.
       */
      if (mode === 'pvp') {
        const queueKey = `${bet}:${preset}`;

        const opponent = pvpQueue.get(queueKey);

        if (opponent && opponent.userId !== userId) {
          pvpQueue.delete(queueKey);

          const game = createGame(
            gameId,
            userId,
            interaction,
            bet,
            preset,
            'pvp',
            opponent.userId
          );

          const opponentGame = highLowGames.get(
            opponent.gameId
          );

          if (opponentGame) {
            opponentGame.opponentId = userId;
            opponentGame.opponentGameId = gameId;
            game.opponentGameId = opponent.gameId;

            await startPvPGame(
              interaction,
              game,
              opponentGame
            );

            await CooldownService.setCooldown(
              userId,
              'highlow',
              config.gamesCooldown
            );

            return;
          }
        }

        const queueEmbed = EmbedService.economy(
          '⚔️ PvP Matchmaking',
          [
            `Your **${bet}-credit** stake has been reserved.`,
            '',
            `**Preset:** ${preset}`,
            `**Rounds:** ${MAX_ROUNDS}`,
            '',
            'Waiting for another player with the same bet and preset...',
            '',
            'If the game times out while waiting for a match, **67% of your original bet is refunded**.',
          ].join('\n')
        );

        const queueMessage = await interaction.editReply({
          embeds: [queueEmbed],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`hl_cancel_queue_${gameId}`)
                .setLabel('Cancel Matchmaking')
                .setStyle(ButtonStyle.Danger)
            ),
          ],
        });

        const game = createGame(
          gameId,
          userId,
          interaction,
          bet,
          preset,
          'pvp'
        );

        game.messageId = queueMessage.id;

        highLowGames.set(gameId, game);

        pvpQueue.set(queueKey, {
          gameId,
          userId,
          bet,
          preset,
          channelId: interaction.channelId,
          messageId: queueMessage.id,
        });

        await CooldownService.setCooldown(
          userId,
          'highlow',
          config.gamesCooldown
        );

        setTimeout(async () => {
          const currentGame = highLowGames.get(gameId);

          if (
            currentGame &&
            currentGame.gameActive &&
            !currentGame.opponentId
          ) {
            pvpQueue.delete(queueKey);

            currentGame.gameActive = false;

            const refund = Math.floor(
              currentGame.originalBet * 0.67
            );

            await EconomyService.addCredits(
              currentGame.userId,
              refund,
              'High/Low PvP timeout refund',
              'HIGH_LOW_TIMEOUT_REFUND'
            );

            try {
              const channel =
                await interaction.client.channels.fetch(
                  currentGame.channelId
                );

              if (
                channel &&
                'messages' in channel
              ) {
                const message =
                  await channel.messages.fetch(
                    currentGame.messageId
                  );

                const embed = EmbedService.economy(
                  '⏰ PvP Matchmaking Timed Out',
                  [
                    'No opponent was found in time.',
                    '',
                    `Original stake: **${currentGame.originalBet} credits**`,
                    `Timeout refund: **${refund} credits (67%)**`,
                  ].join('\n')
                );

                await message.edit({
                  embeds: [embed],
                  components: [],
                });
              }
            } catch (error) {
              console.error(
                'Error updating PvP matchmaking timeout:',
                error
              );
            }

            highLowGames.delete(gameId);
          }
        }, TIMEOUT_MS);

        return;
      }

      const game = createGame(
        gameId,
        userId,
        interaction,
        bet,
        preset,
        'solo'
      );

      const embed = createRoundEmbed(game);

      const message = await interaction.editReply({
        embeds: [embed],
        components: createGameButtons(gameId),
      });

      game.messageId = message.id;

      highLowGames.set(gameId, game);

      const stats = getOrCreateStats(userId);
      stats.gamesPlayed++;

      await CooldownService.setCooldown(
        userId,
        'highlow',
        config.gamesCooldown
      );

      createCollector(
        message,
        game,
        interaction
      );
    } catch (error) {
      console.error('Error in highlow command:', error);

      const embed = EmbedService.error(
        'Error',
        'An error occurred while starting the game.'
      );

      await interaction.editReply({
        embeds: [embed],
      });
    }
  },
};

function createGame(
  gameId: string,
  userId: string,
  interaction: ChatInputCommandInteraction,
  bet: number,
  preset: GamePreset,
  mode: 'solo' | 'pvp',
  opponentId?: string
): HighLowGame {
  return {
    gameId,
    userId,
    channelId: interaction.channelId,
    messageId: '',

    firstNumber: generateNumber(),
    secondNumber: 0,

    bet,
    originalBet: bet,

    round: 1,
    maxRounds: MAX_ROUNDS,

    totalPayout: 0,
    currentRoundWon: false,

    gameActive: true,
    processing: false,
    mode,
    preset,

    opponentId,
  };
}

function createRoundEmbed(game: HighLowGame) {
  const modeLabel =
    game.mode === 'pvp'
      ? `⚔️ PvP vs <@${game.opponentId}>`
      : '🎮 Solo';

  return EmbedService.economy(
    '📈 High/Low',
    [
      `${modeLabel}`,
      '',
      `### Round ${game.round}/${game.maxRounds}`,
      '',
      `The current number is **${game.firstNumber}**.`,
      '',
      'Will the next number be **Higher**, **Lower**, or **Same**?',
      '',
      `**Bet:** ${game.originalBet} credits`,
      `**Preset:** ${game.preset}`,
      `**${getPresetDescription(game.preset)}**`,
      '',
      '🎲 A dynamic multiplier may trigger after a winning guess.',
    ].join('\n')
  )
    .setFooter({
      text: `Game ID: ${game.gameId}`,
    })
    .setTimestamp();
}

function createCollector(
  message: Message,
  game: HighLowGame,
  interaction: ChatInputCommandInteraction
): void {
  const collector =
    message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: TIMEOUT_MS,
    });

  collector.on(
    'collect',
    (i: ButtonInteraction) => withHighLowLock(game.gameId, i, async () => {
      if (i.user.id !== game.userId) {
        await i.reply({
          content: 'This is not your game!',
          ephemeral: true,
        });

        return;
      }

      const currentGame = highLowGames.get(
        game.gameId
      );

      if (
        !currentGame ||
        !currentGame.gameActive
      ) {
        await i.reply({
          content: 'This game has ended.',
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_cancel_queue_${game.gameId}`
      ) {
        await handlePvPQueueCancel(
          i,
          currentGame
        );

        return;
      }

      if (
        i.customId ===
        `hl_stats_${game.gameId}`
      ) {
        await i.reply({
          embeds: [
            createStatsEmbed(game.userId),
          ],
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_rules_${game.gameId}`
      ) {
        await i.reply({
          embeds: [createRulesEmbed()],
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_quit_${game.gameId}`
      ) {
        await endGame(
          game.gameId,
          'quit',
          interaction.client
        );

        await i.update({
          components: [],
        });

        collector.stop('quit');

        return;
      }

      let choice: Choice | null = null;

      if (
        i.customId ===
        `hl_higher_${game.gameId}`
      ) {
        choice = 'higher';
      }

      if (
        i.customId ===
        `hl_lower_${game.gameId}`
      ) {
        choice = 'lower';
      }

      if (
        i.customId ===
        `hl_same_${game.gameId}`
      ) {
        choice = 'same';
      }

      if (!choice) {
        await i.reply({
          content: 'Invalid game action.',
          ephemeral: true,
        });

        return;
      }

      currentGame.secondNumber =
        generateNumber();

      currentGame.lastChoice = choice;

      const isHigher =
        currentGame.secondNumber >
        currentGame.firstNumber;

      const isLower =
        currentGame.secondNumber <
        currentGame.firstNumber;

      const isSame =
        currentGame.secondNumber ===
        currentGame.firstNumber;

      const won =
        (choice === 'higher' && isHigher) ||
        (choice === 'lower' && isLower) ||
        (choice === 'same' && isSame);

      currentGame.currentRoundWon = won;

      recordRound(
        currentGame.userId,
        won,
        0
      );

      if (!won) {
        currentGame.totalPayout = 0;

        await handleRoundLoss(
          i,
          currentGame,
          interaction.client,
          collector
        );

        return;
      }

      const multiplierResult =
        rollMultiplier();

      currentGame.lastMultiplier =
        multiplierResult.multiplier;

      currentGame.lastMultiplierType =
        multiplierResult.type;

      recordMultiplier(
        currentGame.userId,
        multiplierResult.type
      );

      const baseMultiplier =
        choice === 'same'
          ? getSameMultiplier(
              currentGame.preset
            )
          : 1.5;

      const roundPayout = Math.floor(
        currentGame.originalBet *
          baseMultiplier *
          multiplierResult.multiplier
      );

      currentGame.totalPayout +=
        roundPayout;

      /**
       * Record the actual payout separately.
       */
      const stats =
        getOrCreateStats(
          currentGame.userId
        );

      stats.totalWinnings +=
        roundPayout;

      if (
        roundPayout >
        stats.highestPayout
      ) {
        stats.highestPayout =
          roundPayout;
      }

      updateAchievements(
        currentGame.userId
      );
      await saveStats(currentGame.userId);

      await handleWinningRound(
        i,
        currentGame,
        roundPayout,
        multiplierResult,
        baseMultiplier,
        interaction.client,
        collector
      );
    })
  );

  collector.on('end', async (_collected, reason) => {
    const currentGame =
      highLowGames.get(game.gameId);

    if (
      reason === 'time' &&
      currentGame &&
      currentGame.gameActive
    ) {
      await handleTimeout(
        currentGame,
        interaction.client
      );
    }
  });
}

async function handleWinningRound(
  interaction: ButtonInteraction,
  game: HighLowGame,
  roundPayout: number,
  multiplierResult: {
    type: MultiplierType;
    multiplier: number;
  },
  baseMultiplier: number,
  client: Client,
  collector: InteractionCollector<ButtonInteraction>
): Promise<void> {
  /**
   * PvP rounds are decided by each player's guess.
   * The first player to make a winning round does not
   * automatically win the entire PvP match.
   *
   * To keep the interaction simple, the PvP match is
   * settled when one player's total round wins exceeds
   * the opponent's after the final round.
   */
  if (game.mode === 'pvp') {
    await interaction.update({
      embeds: [
        EmbedService.economy(
          `🎉 Round ${game.round} Won!`,
          [
            `The second number was **${game.secondNumber}**.`,
            '',
            `Base payout: **${baseMultiplier}×**`,
            getMultiplierLabel(
              multiplierResult.type,
              multiplierResult.multiplier
            ),
            '',
            `Round payout: **${roundPayout} credits**`,
            `Total potential payout: **${game.totalPayout} credits**`,
            '',
            `Round ${game.round}/${game.maxRounds} complete.`,
            '',
            'Continue to the next round.',
          ].join('\n')
        ),
      ],
      components: [],
    });

    collector.stop('round_complete');

    await advanceToNextRound(
      game,
      client
    );

    return;
  }

  if (game.round >= game.maxRounds) {
    await finishSoloGame(
      interaction,
      game,
      client
    );

    collector.stop('complete');

    return;
  }

  await interaction.update({
    embeds: [
      EmbedService.economy(
        `🎉 Round ${game.round} Won!`,
        [
          `The second number was **${game.secondNumber}**.`,
          '',
          `Base payout: **${baseMultiplier}×**`,
          getMultiplierLabel(
            multiplierResult.type,
            multiplierResult.multiplier
          ),
          '',
          `Round payout: **${roundPayout} credits**`,
          `Current accumulated payout: **${game.totalPayout} credits**`,
          '',
          `Next: Round ${game.round + 1}/${game.maxRounds}`,
        ].join('\n')
      ),
    ],
    components: [],
  });

  collector.stop('round_complete');

  await advanceToNextRound(
    game,
    client
  );
}

async function handleRoundLoss(
  interaction: ButtonInteraction,
  game: HighLowGame,
  client: Client,
  collector: InteractionCollector<ButtonInteraction>
): Promise<void> {
  const description = [
    `The second number was **${game.secondNumber}**.`,
    '',
    `Your choice: **${game.lastChoice}**`,
    '',
    '😢 You lost this round.',
    '',
    game.round < game.maxRounds
      ? `Your accumulated payout is reset to **0 credits**.`
      : 'The game is over.',
  ].join('\n');

  game.totalPayout = 0;

  if (
    game.round >= game.maxRounds
  ) {
    game.gameActive = false;

    const stats =
      getOrCreateStats(
        game.userId
      );

    stats.gamesPlayed++;
    updateAchievements(
      game.userId
    );
    await saveStats(game.userId);

    await interaction.update({
      embeds: [
        EmbedService.economy(
          '📈 High/Low - Game Over',
          description
        ),
      ],
      components: createGameButtons(
        game.gameId,
        true
      ),
    });

    highLowGames.delete(
      game.gameId
    );

    collector.stop('lost');

    return;
  }

  await interaction.update({
    embeds: [
      EmbedService.economy(
        `❌ Round ${game.round} Lost`,
        [
          description,
          '',
          `Next round: **${game.round + 1}/${game.maxRounds}**`,
          '',
          'Your accumulated payout has been reset, but you can continue playing.',
        ].join('\n')
      ),
    ],
    components: [],
  });

  collector.stop('round_lost');

  await advanceToNextRound(
    game,
    client
  );
}

async function advanceToNextRound(
  game: HighLowGame,
  client: Client,
): Promise<void> {
  game.round++;

  if (game.round > game.maxRounds) {
    game.gameActive = false;

    await settleGamePayout(
      game,
      client
    );

    return;
  }

  game.firstNumber =
    generateNumber();

  game.secondNumber = 0;
  game.lastChoice = undefined;
  game.lastMultiplier = undefined;
  game.lastMultiplierType =
    undefined;

  const channel =
    await client.channels.fetch(
      game.channelId
    );

  if (
    !channel ||
    !('messages' in channel)
  ) {
    return;
  }

  const message =
    await channel.messages.fetch(
      game.messageId
    );

  const newCollector =
    message.createMessageComponentCollector(
      {
        componentType:
          ComponentType.Button,
        time: TIMEOUT_MS,
      }
    );

  await message.edit({
    embeds: [
      createRoundEmbed(game),
    ],
    components:
      createGameButtons(
        game.gameId
      ),
  });

  newCollector.on(
    'collect',
    (i: ButtonInteraction) => withHighLowLock(game.gameId, i, async () => {
      if (
        i.user.id !==
        game.userId
      ) {
        await i.reply({
          content:
            'This is not your game!',
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_stats_${game.gameId}`
      ) {
        await i.reply({
          embeds: [
            createStatsEmbed(
              game.userId
            ),
          ],
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_rules_${game.gameId}`
      ) {
        await i.reply({
          embeds: [
            createRulesEmbed(),
          ],
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_quit_${game.gameId}`
      ) {
        await endGame(
          game.gameId,
          'quit',
          client
        );

        await i.update({
          components: [],
        });

        newCollector.stop(
          'quit'
        );

        return;
      }

      let choice: Choice | null =
        null;

      if (
        i.customId ===
        `hl_higher_${game.gameId}`
      ) {
        choice = 'higher';
      } else if (
        i.customId ===
        `hl_lower_${game.gameId}`
      ) {
        choice = 'lower';
      } else if (
        i.customId ===
        `hl_same_${game.gameId}`
      ) {
        choice = 'same';
      }

      if (!choice) {
        return;
      }

      game.secondNumber =
        generateNumber();

      game.lastChoice =
        choice;

      const won =
        (choice === 'higher' &&
          game.secondNumber >
            game.firstNumber) ||
        (choice === 'lower' &&
          game.secondNumber <
            game.firstNumber) ||
        (choice === 'same' &&
          game.secondNumber ===
            game.firstNumber);

      game.currentRoundWon =
        won;

      recordRound(
        game.userId,
        won,
        0
      );

      if (!won) {
        game.totalPayout = 0;

        await handleRoundLoss(
          i,
          game,
          client,
          newCollector
        );

        return;
      }

      const multiplierResult =
        rollMultiplier();

      game.lastMultiplier =
        multiplierResult.multiplier;

      game.lastMultiplierType =
        multiplierResult.type;

      recordMultiplier(
        game.userId,
        multiplierResult.type
      );

      const baseMultiplier =
        choice === 'same'
          ? getSameMultiplier(
              game.preset
            )
          : 1.5;

      const roundPayout =
        Math.floor(
          game.originalBet *
            baseMultiplier *
            multiplierResult.multiplier
        );

      game.totalPayout +=
        roundPayout;

      const stats =
        getOrCreateStats(
          game.userId
        );

      stats.totalWinnings +=
        roundPayout;

      if (
        roundPayout >
        stats.highestPayout
      ) {
        stats.highestPayout =
          roundPayout;
      }

      updateAchievements(
        game.userId
      );
      await saveStats(game.userId);

      if (
        game.round >=
        game.maxRounds
      ) {
        await finishSoloGame(
          i,
          game,
          client
        );

        newCollector.stop(
          'complete'
        );

        return;
      }

      await i.update({
        embeds: [
          EmbedService.economy(
            `🎉 Round ${game.round} Won!`,
            [
              `The second number was **${game.secondNumber}**.`,
              '',
              `Base payout: **${baseMultiplier}×**`,
              getMultiplierLabel(
                multiplierResult.type,
                multiplierResult.multiplier
              ),
              '',
              `Round payout: **${roundPayout} credits**`,
              `Accumulated payout: **${game.totalPayout} credits**`,
              '',
              `Next round: ${game.round + 1}/${game.maxRounds}`,
            ].join('\n')
          ),
        ],
        components: [],
      });

      newCollector.stop(
        'round_complete'
      );

      await advanceToNextRound(
        game,
        client
      );
    })
  );

  newCollector.on(
    'end',
    async (_collected, reason) => {
      const currentGame =
        highLowGames.get(
          game.gameId
        );

      // Only the collector naturally expiring is a timeout.
      // 'round_complete', 'round_lost', 'quit', etc. are intentional stops.
      if (
        reason === 'time' &&
        currentGame &&
        currentGame.gameActive
      ) {
        await handleTimeout(
          currentGame,
          client
        );
      }
    }
  );

}

async function finishSoloGame(
  interaction: ButtonInteraction | null,
  game: HighLowGame,
  client: Client
): Promise<void> {
  game.gameActive = false;

  const payout =
    game.totalPayout;

  if (payout > 0) {
    await EconomyService.addCredits(
      game.userId,
      payout,
      'High/Low payout',
      'HIGH_LOW'
    );
  }

  const stats =
    getOrCreateStats(
      game.userId
    );

  if (payout > 0) {
    stats.gamesWon++;
  }

  updateAchievements(
    game.userId
  );

  const embed =
    EmbedService.economy(
      '🏁 High/Low - Game Over',
      [
        `You completed all **${game.maxRounds} rounds**.`,
        '',
        `**Original Bet:** ${game.originalBet} credits`,
        `**Total Payout:** ${payout} credits`,
        '',
        payout > 0
          ? `🎉 You won **${payout} credits!**`
          : '😢 You finished with no payout.',
        '',
        `**Level:** ${stats.level}`,
        `**Best Streak:** ${stats.bestStreak}`,
      ].join('\n')
    )
      .setFooter({
        text: `Game ID: ${game.gameId}`,
      })
      .setTimestamp();

  try {
    if (
      interaction &&
      typeof interaction.update ===
        'function'
    ) {
      await interaction.update({
        embeds: [embed],
        components:
          createGameButtons(
            game.gameId,
            true
          ),
      });
    } else {
      const channel =
        await client.channels.fetch(
          game.channelId
        );

      if (
        channel &&
        'messages' in channel
      ) {
        const message =
          await channel.messages.fetch(
            game.messageId
          );

        await message.edit({
          embeds: [embed],
          components:
            createGameButtons(
              game.gameId,
              true
            ),
        });
      }
    }
  } catch (error) {
    console.error(
      'Error displaying completed game:',
      error
    );
  }

  highLowGames.delete(
    game.gameId
  );
}

async function settleGamePayout(
  game: HighLowGame,
  client: Client
): Promise<void> {
  if (game.mode !== 'solo') {
    return;
  }

  if (game.totalPayout > 0) {
    await EconomyService.addCredits(
      game.userId,
      game.totalPayout,
      'High/Low payout',
      'HIGH_LOW'
    );
  }

  highLowGames.delete(
    game.gameId
  );
}

async function handleTimeout(
  game: HighLowGame,
  client: Client,
): Promise<void> {
  if (!game.gameActive) {
    return;
  }

  game.gameActive = false;

  /**
   * Timeout refund = exactly 67% of the original stake.
   */
  const refund = Math.floor(
    game.originalBet * 0.67
  );

  if (refund > 0) {
    await EconomyService.addCredits(
      game.userId,
      refund,
      'High/Low timeout refund',
      'HIGH_LOW_TIMEOUT_REFUND'
    );
  }
  await saveStats(game.userId);

  const embed =
    EmbedService.economy(
      '⏰ High/Low - Timed Out',
      [
        'The game timed out.',
        '',
        `Original bet: **${game.originalBet} credits**`,
        `Timeout refund: **${refund} credits (67%)**`,
        '',
        `Forfeited: **${
          game.originalBet - refund
        } credits**`,
        '',
        'Quitting a game does not receive this refund.',
      ].join('\n')
    )
      .setFooter({
        text: `Game ID: ${game.gameId}`,
      })
      .setTimestamp();

  try {
    const channel =
      await client.channels.fetch(
        game.channelId
      );

    if (
      channel &&
      'messages' in channel
    ) {
      const message =
        await channel.messages.fetch(
          game.messageId
        );

      await message.edit({
        embeds: [embed],
        components:
          createGameButtons(
            game.gameId,
            true
          ),
      });
    }
  } catch (error) {
    console.error(
      'Error updating timeout display:',
      error
    );
  }

  highLowGames.delete(
    game.gameId
  );
}

async function handlePvPQueueCancel(
  interaction: ButtonInteraction,
  game: HighLowGame
): Promise<void> {
  game.gameActive = false;

  const queueKey =
    `${game.originalBet}:${game.preset}`;

  pvpQueue.delete(queueKey);

  /**
   * Cancellation is treated as a quit:
   * no refund.
   */
  const embed =
    EmbedService.economy(
      '🚪 PvP Matchmaking Cancelled',
      [
        'You cancelled matchmaking.',
        '',
        `Your ${game.originalBet}-credit stake was forfeited.`,
        '',
        'No timeout refund applies when you voluntarily quit.',
      ].join('\n')
    );

  await interaction.update({
    embeds: [embed],
    components: [],
  });

  highLowGames.delete(
    game.gameId
  );
}

async function startPvPGame(
  interaction: ChatInputCommandInteraction,
  game: HighLowGame,
  opponentGame: HighLowGame
): Promise<void> {
  game.messageId = (
    await interaction.fetchReply()
  ).id;

  highLowGames.set(
    game.gameId,
    game
  );

  const opponentStats =
    getOrCreateStats(
      opponentGame.userId
    );

  const playerStats =
    getOrCreateStats(
      game.userId
    );

  playerStats.gamesPlayed++;
  playerStats.pvpGames++;

  opponentStats.gamesPlayed++;
  opponentStats.pvpGames++;

  /**
   * Both players are already charged their own stake.
   * There is no house fee.
   */
  const embed =
    EmbedService.economy(
      '⚔️ PvP High/Low Match',
      [
        `You are matched against <@${opponentGame.userId}>.`,
        '',
        `**Stake:** ${game.originalBet} credits each`,
        `**Prize pool:** ${game.originalBet * 2} credits`,
        `**Rounds:** ${MAX_ROUNDS}`,
        '',
        'There is **no house fee**.',
        'The eventual winner receives the full opponent stake plus a 10% winner bonus.',
        '',
        createRoundEmbed(
          game
        ).data.description ?? '',
      ].join('\n')
    );

  try {
    const channel =
      await interaction.client.channels.fetch(
        game.channelId
      );

    if (
      channel &&
      'messages' in channel
    ) {
      const message =
        await channel.messages.fetch(
          game.messageId
        );

      await message.edit({
        embeds: [embed],
        components:
          createGameButtons(
            game.gameId
          ),
      });

      const collector =
        message.createMessageComponentCollector(
          {
            componentType:
              ComponentType.Button,
            time: TIMEOUT_MS,
          }
        );

      setupPvPCollector(
        collector,
        game,
        opponentGame,
        interaction.client
      );
    }
  } catch (error) {
    console.error(
      'Error starting PvP game:',
      error
    );
  }
}

function setupPvPCollector(
  collector: InteractionCollector<ButtonInteraction>,
  game: HighLowGame,
  opponentGame: HighLowGame,
  client: Client,
): void {
  let playerWins = 0;
  let opponentWins = 0;

  collector.on(
    'collect',
    (i: ButtonInteraction) => withHighLowLock(game.gameId, i, async () => {
      if (
        i.user.id !== game.userId
      ) {
        await i.reply({
          content:
            'This is not your game!',
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_stats_${game.gameId}`
      ) {
        await i.reply({
          embeds: [
            createStatsEmbed(
              game.userId
            ),
          ],
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_rules_${game.gameId}`
      ) {
        await i.reply({
          embeds: [
            createRulesEmbed(),
          ],
          ephemeral: true,
        });

        return;
      }

      if (
        i.customId ===
        `hl_quit_${game.gameId}`
      ) {
        game.gameActive = false;
        opponentGame.gameActive =
          false;

        await settlePvPWinner(
          opponentGame,
          game,
          opponentGame.userId,
          client,
          'opponent_quit'
        );

        await i.update({
          components: [],
        });

        collector.stop(
          'quit'
        );

        return;
      }

      let choice: Choice | null =
        null;

      if (
        i.customId ===
        `hl_higher_${game.gameId}`
      ) {
        choice = 'higher';
      } else if (
        i.customId ===
        `hl_lower_${game.gameId}`
      ) {
        choice = 'lower';
      } else if (
        i.customId ===
        `hl_same_${game.gameId}`
      ) {
        choice = 'same';
      }

      if (!choice) {
        return;
      }

      game.secondNumber =
        generateNumber();

      const won =
        (choice === 'higher' &&
          game.secondNumber >
            game.firstNumber) ||
        (choice === 'lower' &&
          game.secondNumber <
            game.firstNumber) ||
        (choice === 'same' &&
          game.secondNumber ===
            game.firstNumber);

      recordRound(
        game.userId,
        won,
        0
      );

      if (won) {
        playerWins++;
      } else {
        opponentWins++;
      }

      if (
        playerWins >= 3 ||
        opponentWins >= 3 ||
        game.round >=
          MAX_ROUNDS
      ) {
        game.gameActive = false;
        opponentGame.gameActive =
          false;

        const winner =
          playerWins >
          opponentWins
            ? game.userId
            : opponentWins >
              playerWins
            ? opponentGame.userId
            : null;

        if (winner) {
          await settlePvPWinner(
            game,
            opponentGame,
            winner,
            client,
            'completed'
          );
        } else {
          /**
           * Tie: return both stakes.
           * There is no house fee.
           */
          await EconomyService.addCredits(
            game.userId,
            game.originalBet,
            'High/Low PvP tie refund',
            'HIGH_LOW_PVP_TIE'
          );

          await EconomyService.addCredits(
            opponentGame.userId,
            opponentGame.originalBet,
            'High/Low PvP tie refund',
            'HIGH_LOW_PVP_TIE'
          );
        }

        await i.update({
          embeds: [
            EmbedService.economy(
              '⚔️ PvP Match Complete',
              [
                `Your score: **${playerWins}**`,
                `Opponent score: **${opponentWins}**`,
                '',
                winner
                  ? `🏆 Winner: <@${winner}>`
                  : '🤝 The match ended in a tie.',
              ].join('\n')
            ),
          ],
          components: [],
        });

        collector.stop(
          'complete'
        );

        return;
      }

      game.round++;
      game.firstNumber =
        generateNumber();

      await i.update({
        embeds: [
          EmbedService.economy(
            `⚔️ PvP Round ${game.round}/${MAX_ROUNDS}`,
            [
              `You ${won ? 'won' : 'lost'} the previous round.`,
              '',
              `Your score: **${playerWins}**`,
              `Opponent score: **${opponentWins}**`,
              '',
              `New number: **${game.firstNumber}**`,
              '',
              'Higher, Lower, or Same?',
            ].join('\n')
          ),
        ],
        components:
          createGameButtons(
            game.gameId
          ),
      });
    })
  );

  collector.on(
    'end',
    async (_collected, reason) => {
      // Only refund for an actual timeout.
      // A manual collector.stop('complete') or
      // collector.stop('quit') is NOT a timeout.
      if (reason !== 'time') {
        return;
      }

      if (
        !game.gameActive ||
        !opponentGame.gameActive
      ) {
        return;
      }

      game.gameActive = false;
      opponentGame.gameActive =
        false;

      /**
       * Timeout in PvP refunds 67% to both players.
       */
      const playerRefund =
        Math.floor(
          game.originalBet * 0.67
        );

      const opponentRefund =
        Math.floor(
          opponentGame.originalBet *
            0.67
        );

      await EconomyService.addCredits(
        game.userId,
        playerRefund,
        'High/Low PvP timeout refund',
        'HIGH_LOW_TIMEOUT_REFUND'
      );

      await EconomyService.addCredits(
        opponentGame.userId,
        opponentRefund,
        'High/Low PvP timeout refund',
        'HIGH_LOW_TIMEOUT_REFUND'
      );

      highLowGames.delete(
        game.gameId
      );

      highLowGames.delete(
        opponentGame.gameId
      );
    }
  );
}

async function settlePvPWinner(
  playerGame: HighLowGame,
  opponentGame: HighLowGame,
  winnerId: string,
  client: Client,
  reason:
    | 'completed'
    | 'opponent_quit'
): Promise<void> {
  const totalPool =
    playerGame.originalBet +
    opponentGame.originalBet;

  /**
   * Winner receives:
   * - both stakes
   * - 10% winner bonus
   *
   * No house fee is taken.
   */
  const winnerBonus = Math.floor(
    totalPool * 0.10
  );

  const winnerPayout =
    totalPool + winnerBonus;

  await EconomyService.addCredits(
    winnerId,
    winnerPayout,
    'High/Low PvP winner payout',
    'HIGH_LOW_PVP'
  );

  const winnerStats =
    getOrCreateStats(
      winnerId
    );

  winnerStats.pvpWins++;
  winnerStats.gamesWon++;
  winnerStats.totalWinnings +=
    winnerPayout;

  if (
    winnerPayout >
    winnerStats.highestPayout
  ) {
    winnerStats.highestPayout =
      winnerPayout;
  }

  addXP(
    winnerId,
    100
  );

  if (
    reason === 'opponent_quit'
  ) {
    addXP(
      winnerId,
      25
    );
  }

  updateAchievements(
    winnerId
  );

  highLowGames.delete(
    playerGame.gameId
  );

  highLowGames.delete(
    opponentGame.gameId
  );
}

async function endGame(
  gameId: string,
  choice: 'quit' | string,
  client: Client,
): Promise<void> {
  const game =
    highLowGames.get(gameId);

  if (!game) {
    return;
  }

  if (!game.gameActive) {
    return;
  }

  game.gameActive = false;

  if (choice === 'quit') {
    /**
     * Explicit quit = 0 refund.
     */
    const result =
      `🚪 You quit the game. Your bet of ${game.originalBet} credits is forfeited.`;

    const embed =
      EmbedService.economy(
        '📈 High/Low - Game Over',
        [
          result,
          '',
          '**Refund:** 0 credits',
          '',
          'Quitting does not qualify for the 67% timeout refund.',
        ].join('\n')
      )
        .setFooter({
          text: `Game ID: ${gameId}`,
        })
        .setTimestamp();

    try {
      const channel =
        await client.channels.fetch(
          game.channelId
        );

      if (
        channel &&
        'messages' in channel
      ) {
        const message =
          await channel.messages.fetch(
            game.messageId
          );

        await message.edit({
          embeds: [embed],
          components:
            createGameButtons(
              gameId,
              true
            ),
        });
      }
    } catch (error) {
      console.error(
        'Error updating quit display:',
        error
      );
    }

    highLowGames.delete(
      gameId
    );

    return;
  }

  await handleTimeout(
    game,
    client
  );
}
