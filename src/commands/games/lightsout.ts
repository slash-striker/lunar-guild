import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  Client,
  Message,
  ButtonInteraction,
  EmbedBuilder,
  User,
} from 'discord.js';

import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import prisma from '../../database/client.ts';

type Difficulty = 'easy' | 'normal' | 'hard';
type GameMode = 'classic' | 'daily' | 'challenge' | 'battle';

interface DifficultyConfig {
  size: number;
  baseReward: number;
  maxReward: number;
  label: string;
  emoji: string;
}

interface LightsOutStats {
  userId: string;
  gamesPlayed: number;
  wins: number;
  totalMoves: number;
  bestMoves: number | null;
  bestTimeMs: number | null;
  currentStreak: number;
  bestStreak: number;
  hintsUsed: number;
  perfectWins: number;
  dailyWins: number;
  challengesWon: number;
  battlesWon: number;
}

interface LightsOutGame {
  gameId: string;
  userId: string;
  opponentId?: string;

  channelId: string;
  messageId: string;

  grid: boolean[];
  initialGrid: boolean[];

  size: number;
  difficulty: Difficulty;
  mode: GameMode;

  attempts: number;
  hintsUsed: number;

  startedAt: number;
  gameActive: boolean;
  processing: boolean;
  page: number;

  history: boolean[][];
  undoUsed: boolean;
  resetUsed: boolean;

  optimalMoves: number;

  // Challenge/daily metadata
  seed?: number;

  // Battle state
  battleScores?: Record<string, number>;
  battleFinished?: boolean;
}

interface LeaderboardEntry {
  userId: string;
  stats: LightsOutStats;
}

const lightsOutGames = new Map<string, LightsOutGame>();
const playerStats = new Map<string, LightsOutStats>();

const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: {
    size: 3,
    baseReward: 200,
    maxReward: 500,
    label: 'Easy',
    emoji: '🟢',
  },
  normal: {
    size: 4,
    baseReward: 400,
    maxReward: 1000,
    label: 'Normal',
    emoji: '🟡',
  },
  hard: {
    size: 5,
    baseReward: 700,
    maxReward: 1800,
    label: 'Hard',
    emoji: '🔴',
  },
};

const GAME_TIMEOUT = 5 * 60 * 1000;
const MAX_HISTORY = 100;

function getStats(userId: string): LightsOutStats {
  let stats = playerStats.get(userId);

  if (!stats) {
    stats = {
      userId,
      gamesPlayed: 0,
      wins: 0,
      totalMoves: 0,
      bestMoves: null,
      bestTimeMs: null,
      currentStreak: 0,
      bestStreak: 0,
      hintsUsed: 0,
      perfectWins: 0,
      dailyWins: 0,
      challengesWon: 0,
      battlesWon: 0,
    };

    playerStats.set(userId, stats);
  }

  return stats;
}

async function loadStats(
  userId: string,
  guildId: string,
): Promise<LightsOutStats> {
  await prisma.user.upsert({
    where: { discordId: userId },
    update: {},
    create: {
      discordId: userId,
      guildId,
    },
  });

  const storedStats = await prisma.lightsOutStats.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const stats: LightsOutStats = {
    userId,
    gamesPlayed: storedStats.gamesPlayed,
    wins: storedStats.wins,
    totalMoves: storedStats.totalMoves,
    bestMoves: storedStats.bestMoves,
    bestTimeMs: storedStats.bestTimeMs,
    currentStreak: storedStats.currentStreak,
    bestStreak: storedStats.bestStreak,
    hintsUsed: storedStats.hintsUsed,
    perfectWins: storedStats.perfectWins,
    dailyWins: storedStats.dailyWins,
    challengesWon: storedStats.challengesWon,
    battlesWon: storedStats.battlesWon,
  };

  playerStats.set(userId, stats);
  return stats;
}

async function saveStats(userId: string): Promise<void> {
  const stats = getStats(userId);

  await prisma.lightsOutStats.upsert({
    where: { userId },
    update: {
      gamesPlayed: stats.gamesPlayed,
      wins: stats.wins,
      totalMoves: stats.totalMoves,
      bestMoves: stats.bestMoves,
      bestTimeMs: stats.bestTimeMs,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
      hintsUsed: stats.hintsUsed,
      perfectWins: stats.perfectWins,
      dailyWins: stats.dailyWins,
      challengesWon: stats.challengesWon,
      battlesWon: stats.battlesWon,
    },
    create: {
      userId,
      gamesPlayed: stats.gamesPlayed,
      wins: stats.wins,
      totalMoves: stats.totalMoves,
      bestMoves: stats.bestMoves,
      bestTimeMs: stats.bestTimeMs,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
      hintsUsed: stats.hintsUsed,
      perfectWins: stats.perfectWins,
      dailyWins: stats.dailyWins,
      challengesWon: stats.challengesWon,
      battlesWon: stats.battlesWon,
    },
  });
}

function cloneGrid(grid: boolean[]): boolean[] {
  return [...grid];
}

function createEmptyGrid(size: number): boolean[] {
  return new Array(size * size).fill(false);
}

function toggleLight(
  grid: boolean[],
  index: number,
  size: number,
): void {
  if (!Number.isInteger(index) || index < 0 || index >= grid.length) {
    return;
  }

  const row = Math.floor(index / size);
  const col = index % size;

  grid[index] = !grid[index];

  if (row > 0) {
    grid[index - size] = !grid[index - size];
  }

  if (row < size - 1) {
    grid[index + size] = !grid[index + size];
  }

  if (col > 0) {
    grid[index - 1] = !grid[index - 1];
  }

  if (col < size - 1) {
    grid[index + 1] = !grid[index + 1];
  }
}

function applyMove(
  grid: boolean[],
  index: number,
  size: number,
): boolean[] {
  const result = cloneGrid(grid);
  toggleLight(result, index, size);
  return result;
}

function isSolved(grid: boolean[]): boolean {
  return grid.every(light => !light);
}

function countLights(grid: boolean[]): number {
  return grid.reduce((count, light) => count + (light ? 1 : 0), 0);
}

/**
 * Generates a deterministic pseudo-random number from a seed.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

/**
 * Creates a solvable puzzle by starting with an empty board and
 * applying random valid moves.
 */
function createSolvableGrid(
  size: number,
  seed?: number,
  moveCount?: number,
): boolean[] {
  const grid = createEmptyGrid(size);
  const random = seededRandom(seed ?? randomSeed());

  const totalCells = size * size;

  const moves =
    moveCount ??
    Math.max(
      size * 2,
      Math.floor(totalCells * 0.55),
    );

  for (let i = 0; i < moves; i++) {
    const index = Math.floor(random() * totalCells);
    toggleLight(grid, index, size);
  }

  // Avoid accidentally generating an already-solved puzzle.
  if (isSolved(grid)) {
    toggleLight(
      grid,
      Math.floor(random() * totalCells),
      size,
    );
  }

  return grid;
}

/**
 * Returns a deterministic seed for a calendar day.
 *
 * Everyone using the same date receives the same daily puzzle.
 */
function getDailySeed(date = new Date()): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  let hash = 2166136261;

  const value = `${year}-${month}-${day}-lightsout`;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Standard Lights Out solver.
 *
 * For each possible first-row press combination, all subsequent
 * rows are forced. There are only 2^size combinations.
 *
 * This works well for the supported 3x3, 4x4, and 5x5 boards.
 */
function solveLightsOut(
  initialGrid: boolean[],
  size: number,
): number[] | null {
  const total = size * size;
  let bestSolution: number[] | null = null;

  const firstRowCombinations = 1 << size;

  for (
    let firstMask = 0;
    firstMask < firstRowCombinations;
    firstMask++
  ) {
    const board = cloneGrid(initialGrid);
    const moves: number[] = [];

    // Press first row according to mask.
    for (let col = 0; col < size; col++) {
      if ((firstMask & (1 << col)) !== 0) {
        const index = col;
        toggleLight(board, index, size);
        moves.push(index);
      }
    }

    // Force rows 1..size-1.
    for (let row = 1; row < size; row++) {
      const previousRow = row - 1;

      for (let col = 0; col < size; col++) {
        const previousIndex =
          previousRow * size + col;

        if (board[previousIndex]) {
          const index = row * size + col;

          toggleLight(board, index, size);
          moves.push(index);
        }
      }
    }

    // Check final row.
    let solved = true;

    for (let col = 0; col < size; col++) {
      const index =
        (size - 1) * size + col;

      if (board[index]) {
        solved = false;
        break;
      }
    }

    if (solved && board.every(light => !light)) {
      if (
        bestSolution === null ||
        moves.length < bestSolution.length
      ) {
        bestSolution = moves;
      }
    }
  }

  // Silence unused variable warning in some TS configurations.
  void total;

  return bestSolution;
}

function getOptimalMoves(
  grid: boolean[],
  size: number,
): number {
  const solution = solveLightsOut(grid, size);

  // A solvable puzzle should always have a solution.
  // Returning 0 keeps the game functional if something unexpected
  // occurs.
  return solution?.length ?? 0;
}

function getRecommendedMove(
  grid: boolean[],
  size: number,
): number | null {
  const solution = solveLightsOut(grid, size);
  return solution?.[0] ?? null;
}

function calculateEfficiency(
  attempts: number,
  optimalMoves: number,
): number {
  if (attempts <= 0) {
    return 0;
  }

  if (optimalMoves <= 0) {
    return 100;
  }

  const efficiency =
    (optimalMoves / attempts) * 100;

  return Math.max(
    0,
    Math.min(100, Math.round(efficiency)),
  );
}

function calculateReward(
  game: LightsOutGame,
): number {
  const config = DIFFICULTIES[game.difficulty];

  const efficiency = calculateEfficiency(
    game.attempts,
    game.optimalMoves,
  );

  let reward = config.baseReward;

  // Efficiency bonuses.
  if (efficiency >= 100) {
    reward += Math.floor(config.baseReward * 0.75);
  } else if (efficiency >= 90) {
    reward += Math.floor(config.baseReward * 0.5);
  } else if (efficiency >= 75) {
    reward += Math.floor(config.baseReward * 0.25);
  }

  // No-hint bonus.
  if (game.hintsUsed === 0) {
    reward += 100;
  }

  // Hard-mode bonus.
  if (game.difficulty === 'hard') {
    reward += 200;
  }

  if (game.mode === 'challenge') {
    reward = Math.floor(reward * 1.25);
  }

  return Math.min(
    reward,
    config.maxReward,
  );
}

function createGameId(
  userId: string,
): string {
  return `${userId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getDifficultyFromInteraction(
  interaction: ChatInputCommandInteraction,
): Difficulty {
  return (
    interaction.options.getString(
      'difficulty',
    ) as Difficulty | null
  ) ?? 'normal';
}

function createButton(
  game: LightsOutGame,
  index: number,
): ButtonBuilder {
  const isOn = game.grid[index];

  return new ButtonBuilder()
    .setCustomId(
      `lo_${game.gameId}_${index}`,
    )
    .setLabel(isOn ? '💡' : '⬛')
    .setStyle(
      isOn
        ? ButtonStyle.Primary
        : ButtonStyle.Secondary,
    )
    .setDisabled(
      !game.gameActive ||
      game.processing,
    );
}

function createButtonRows(
  game: LightsOutGame,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const size = game.size;

  /*
   * Discord only allows 5 buttons per ActionRow.
   *
   * Every supported board size fits within Discord's button limits.
   */
  for (let row = 0; row < size; row++) {
    const start = row * size;

    if (size <= 5) {
      const actionRow =
        new ActionRowBuilder<ButtonBuilder>();

      for (
        let col = 0;
        col < size;
        col++
      ) {
        actionRow.addComponents(
          createButton(
            game,
            start + col,
          ),
        );
      }

      rows.push(actionRow);
    } else {
      // Defensive fallback for unsupported board sizes.
      const firstRow =
        new ActionRowBuilder<ButtonBuilder>();

      for (
        let col = 0;
        col < 4;
        col++
      ) {
        firstRow.addComponents(
          createButton(
            game,
            start + col,
          ),
        );
      }

      rows.push(firstRow);

      const secondRow =
        new ActionRowBuilder<ButtonBuilder>();

      for (
        let col = 4;
        col < 7;
        col++
      ) {
        secondRow.addComponents(
          createButton(
            game,
            start + col,
          ),
        );
      }

      rows.push(secondRow);
    }
  }

  /*
   * Discord permits a maximum of 5 ActionRows on a message.
   *
   * Larger boards cannot be represented
   * directly with one button message.
   *
   * We handle this below by using compact pagination/sections.
   */
  if (rows.length > 4) {
    return createPagedButtonRows(game);
  }

  // For 3x3/5x5, add controls in the final row if possible.
  const controls =
    new ActionRowBuilder<ButtonBuilder>();

  controls.addComponents(
    new ButtonBuilder()
      .setCustomId(
        `lo_hint_${game.gameId}`,
      )
      .setLabel('💡 Hint')
      .setStyle(ButtonStyle.Success)
      .setDisabled(
        !game.gameActive ||
        game.processing,
      ),

    new ButtonBuilder()
      .setCustomId(
        `lo_undo_${game.gameId}`,
      )
      .setLabel('↩️ Undo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(
        !game.gameActive ||
        game.history.length === 0 ||
        game.undoUsed ||
        game.processing,
      ),

    new ButtonBuilder()
      .setCustomId(
        `lo_reset_${game.gameId}`,
      )
      .setLabel('🔄 Reset')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(
        !game.gameActive ||
        game.resetUsed ||
        game.processing,
      ),

    new ButtonBuilder()
      .setCustomId(
        `lo_quit_${game.gameId}`,
      )
      .setLabel('🚪 Quit')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(
        !game.gameActive ||
        game.processing,
      ),
  );

  if (rows.length < 5) {
    rows.push(controls);
  }

  return rows.slice(0, 5);
}

/**
 * Discord messages have a hard limit of five action rows.
 *
 * Legacy paging for oversized boards.
 * Players can navigate horizontally between board sections.
 */
function createPagedButtonRows(
  game: LightsOutGame,
): ActionRowBuilder<ButtonBuilder>[] {
  const size = game.size;

  if (size !== 7) {
    return [];
  }

  /*
   * Use four columns per page.
   * Page is derived from a hidden property encoded in the game ID
   * isn't practical, so default to page 0.
   *
   * The actual page is controlled through the custom ID and handled
   * by createPageRows below.
   */
  return createPageRows(game, 0);
}

function createPageRows(
  game: LightsOutGame,
  page: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const size = game.size;

  if (size !== 7) {
    const rows = createButtonRows(game);
    return rows.slice(0, 5);
  }

  const startCol = page === 0 ? 0 : 4;
  const endCol = page === 0 ? 4 : 7;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let row = 0; row < size; row++) {
    const actionRow =
      new ActionRowBuilder<ButtonBuilder>();

    for (
      let col = startCol;
      col < endCol;
      col++
    ) {
      actionRow.addComponents(
        createButton(
          game,
          row * size + col,
        ),
      );
    }

    rows.push(actionRow);
  }

  /*
   * Seven board rows exceed Discord's five-row limit.
   *
   * For hard mode, display four board rows at a time and use
   * vertical navigation.
   */
  return rows.slice(0, 5);
}

function createControlRows(
  game: LightsOutGame,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  const row1 =
    new ActionRowBuilder<ButtonBuilder>();

  row1.addComponents(
    new ButtonBuilder()
      .setCustomId(
        `lo_hint_${game.gameId}`,
      )
      .setLabel('💡 Hint')
      .setStyle(ButtonStyle.Success)
      .setDisabled(
        !game.gameActive ||
        game.processing,
      ),

    new ButtonBuilder()
      .setCustomId(
        `lo_undo_${game.gameId}`,
      )
      .setLabel('↩️ Undo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(
        !game.gameActive ||
        game.history.length === 0 ||
        game.undoUsed ||
        game.processing,
      ),

    new ButtonBuilder()
      .setCustomId(
        `lo_reset_${game.gameId}`,
      )
      .setLabel('🔄 Reset')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(
        !game.gameActive ||
        game.resetUsed ||
        game.processing,
      ),

    new ButtonBuilder()
      .setCustomId(
        `lo_quit_${game.gameId}`,
      )
      .setLabel('🚪 Quit')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(
        !game.gameActive ||
        game.processing,
      ),
  );

  rows.push(row1);

  return rows;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);

  const minutes = Math.floor(
    seconds / 60,
  );

  const remainingSeconds =
    seconds % 60;

  return `${minutes
    .toString()
    .padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}`;
}

function getGameTime(game: LightsOutGame): number {
  return Math.max(
    0,
    Date.now() - game.startedAt,
  );
}

function buildGameDescription(
  game: LightsOutGame,
): string {
  const config =
    DIFFICULTIES[game.difficulty];

  const lightsRemaining =
    countLights(game.grid);

  const elapsed =
    getGameTime(game);

  const efficiency =
    game.attempts > 0
      ? calculateEfficiency(
          game.attempts,
          game.optimalMoves,
        )
      : 0;

  let description =
    `Turn off all the lights! Clicking a light toggles it and its neighbors.\n\n`;

  description +=
    `${config.emoji} Difficulty: **${config.label}**\n`;

  description +=
    `💡 Lights remaining: **${lightsRemaining}**\n`;

  description +=
    `🎯 Attempts: **${game.attempts}**\n`;

  description +=
    `⭐ Optimal: **${game.optimalMoves}** moves\n`;

  description +=
    `⏱️ Time: **${formatTime(elapsed)}**\n`;

  if (game.attempts > 0) {
    description +=
      `📊 Efficiency: **${efficiency}%**\n`;
  }

  if (game.hintsUsed > 0) {
    description +=
      `💡 Hints used: **${game.hintsUsed}**\n`;
  }

  if (game.mode === 'daily') {
    description +=
      `\n📅 **Daily Puzzle** — everyone gets the same board today.`;
  } else if (game.mode === 'challenge') {
    description +=
      `\n🔥 **Challenge Mode** — higher rewards for efficient solves.`;
  } else if (game.mode === 'battle') {
    description +=
      `\n⚔️ **Battle Mode**`;
  }

  return description;
}

function createGameEmbed(
  game: LightsOutGame,
): EmbedBuilder {
  const config =
    DIFFICULTIES[game.difficulty];

  const title =
    game.mode === 'daily'
      ? '💡 Lights Out — Daily Puzzle'
      : game.mode === 'challenge'
        ? '💡 Lights Out — Challenge'
        : game.mode === 'battle'
          ? '💡 Lights Out — Battle'
          : '💡 Lights Out';

  return EmbedService.economy(
    title,
    buildGameDescription(game),
  )
    .setFooter({
      text: `Game ID: ${game.gameId} • ${config.label} ${config.size}×${config.size}`,
    })
    .setTimestamp();
}

function createGameRows(
  game: LightsOutGame,
): ActionRowBuilder<ButtonBuilder>[] {
  if (game.size <= 5) {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const size = game.size;

    for (
      let row = 0;
      row < size;
      row++
    ) {
      const actionRow =
        new ActionRowBuilder<ButtonBuilder>();

      for (
        let col = 0;
        col < size;
        col++
      ) {
        actionRow.addComponents(
          createButton(
            game,
            row * size + col,
          ),
        );
      }

      rows.push(actionRow);
    }

    const controls =
      createControlRows(game)[0];

    if (rows.length < 5) {
      rows.push(controls);
    }

    return rows;
  }

  /*
   * Legacy oversized-board mode.
   *
   * Discord only supports five action rows per message, so we
   * represent the board as a scrolling 7-row board.
   *
   * The current visible section is encoded into custom IDs.
   */
  return createHardModeRows(game, game.page);
}

function createHardModeRows(
  game: LightsOutGame,
  page: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const normalizedPage = Math.max(0, Math.min(3, page));
  const rowPage = Math.floor(normalizedPage / 2);
  const columnPage = normalizedPage % 2;
  const startRow = rowPage === 0 ? 0 : 4;
  const endRow = rowPage === 0 ? 4 : 7;
  const startColumn = columnPage === 0 ? 0 : 5;
  const endColumn = columnPage === 0 ? 5 : 7;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (
    let row = startRow;
    row < endRow;
    row++
  ) {
    const actionRow =
      new ActionRowBuilder<ButtonBuilder>();

    for (let col = startColumn; col < endColumn; col++) {
      actionRow.addComponents(
        createButton(
          game,
          row * 7 + col,
        ),
      );
    }

    rows.push(actionRow);
  }

  const controls = new ActionRowBuilder<ButtonBuilder>();
  const disabled = !game.gameActive || game.processing;

  controls.addComponents(
    new ButtonBuilder()
      .setCustomId(`lo_page_${game.gameId}_${normalizedPage - 1}`)
      .setLabel('◀️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || normalizedPage === 0),
    new ButtonBuilder()
      .setCustomId(`lo_page_${game.gameId}_${normalizedPage + 1}`)
      .setLabel('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || normalizedPage === 3),
    new ButtonBuilder()
      .setCustomId(`lo_hint_${game.gameId}`)
      .setLabel('💡 Hint')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`lo_undo_${game.gameId}`)
      .setLabel('↩️ Undo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || game.history.length === 0),
    new ButtonBuilder()
      .setCustomId(`lo_quit_${game.gameId}`)
      .setLabel('🚪 Quit')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );

  rows.push(controls);

  return rows;
}

async function updateGameDisplay(
  gameId: string,
  client: Client,
  page = 0,
): Promise<void> {
  const game =
    lightsOutGames.get(gameId);

  if (!game) {
    return;
  }

  const embed =
    createGameEmbed(game);

  const rows =
    game.size === 7
      ? createHardModeRows(game, game.page = page)
      : createGameRows(game);

  try {
    const channel =
      await client.channels.fetch(
        game.channelId,
      );

    if (
      channel &&
      'messages' in channel
    ) {
      const message =
        await channel.messages.fetch(
          game.messageId,
        );

      await message.edit({
        embeds: [embed],
        components: rows,
      });
    }
  } catch (error) {
    console.error(
      'Error updating Lights Out display:',
      error,
    );
  }
}

async function disableGameButtons(
  game: LightsOutGame,
  client: Client,
): Promise<void> {
  try {
    const channel =
      await client.channels.fetch(
        game.channelId,
      );

    if (
      channel &&
      'messages' in channel
    ) {
      const message =
        await channel.messages.fetch(
          game.messageId,
        );

      const disabledRows =
        createGameRows(game).map(row => {
          row.components.forEach(component => {
            component.setDisabled(true);
          });

          return row;
        });

      await message.edit({
        components: disabledRows,
      });
    }
  } catch (error) {
    console.error(
      'Error disabling Lights Out buttons:',
      error,
    );
  }
}

async function endGame(
  gameId: string,
  result:
    | 'win'
    | 'timeout'
    | 'quit',
  client: Client,
): Promise<void> {
  const game =
    lightsOutGames.get(gameId);

  if (!game) {
    return;
  }

  if (!game.gameActive) {
    return;
  }

  game.gameActive = false;
  game.processing = false;

  const elapsed =
    getGameTime(game);

  const stats =
    getStats(game.userId);

  let description = '';
  let reward = 0;

  if (result === 'win') {
    reward = calculateReward(game);

    const efficiency =
      calculateEfficiency(
        game.attempts,
        game.optimalMoves,
      );

    const perfect =
      game.attempts === game.optimalMoves;

    stats.wins++;
    stats.currentStreak++;

    stats.bestStreak =
      Math.max(
        stats.bestStreak,
        stats.currentStreak,
      );

    if (
      stats.bestMoves === null ||
      game.attempts < stats.bestMoves
    ) {
      stats.bestMoves =
        game.attempts;
    }

    if (
      stats.bestTimeMs === null ||
      elapsed < stats.bestTimeMs
    ) {
      stats.bestTimeMs =
        elapsed;
    }

    if (perfect) {
      stats.perfectWins++;
    }

    if (game.mode === 'daily') {
      const dateKey = getDateKey();

      const existingDailyWin = await prisma.lightsOutDailyWin.findUnique({
        where: {
          userId_dateKey: {
            userId: game.userId,
            dateKey,
          },
        },
      });

      if (!existingDailyWin) {
        stats.dailyWins++;

        await prisma.lightsOutDailyWin.create({
          data: {
            userId: game.userId,
            dateKey,
          },
        });
      }
    }

    if (game.mode === 'challenge') {
      stats.challengesWon++;
    }

    if (game.mode === 'battle') {
      stats.battlesWon++;
    }

    await EconomyService.addCredits(
      game.userId,
      reward,
      'Lights Out win',
      'LIGHTS_OUT',
    );

    description =
      `🎉 **Puzzle solved!**\n\n` +
      `🎯 Attempts: **${game.attempts}**\n` +
      `⭐ Optimal: **${game.optimalMoves}**\n` +
      `📊 Efficiency: **${efficiency}%**\n` +
      `⏱️ Time: **${formatTime(elapsed)}**\n\n` +
      `💰 Reward: **${reward} credits**\n`;

    if (perfect) {
      description +=
        `\n🏆 **Perfect solve!**`;
    }

    if (game.hintsUsed === 0) {
      description +=
        `\n💡 **No-hint bonus included!**`;
    }

    description +=
      `\n🔥 Win streak: **${stats.currentStreak}**`;
  } else {
    stats.currentStreak = 0;

    if (result === 'timeout') {
      description =
        `⏰ **Game timed out!**\n\n` +
        `You made **${game.attempts}** attempts.\n` +
        `Lights remaining: **${countLights(
          game.grid,
        )}**`;
    } else {
      description =
        `🚪 **You quit the game.**\n\n` +
        `You made **${game.attempts}** attempts.`;
    }
  }

  stats.totalMoves += game.attempts;

  await saveStats(game.userId);

  const title =
    result === 'win'
      ? '💡 Lights Out — Victory!'
      : '💡 Lights Out — Game Over';

  const embed =
    EmbedService.economy(
      title,
      description,
    )
      .setFooter({
        text: `Game ID: ${game.gameId}`,
      })
      .setTimestamp();

  try {
    const channel =
      await client.channels.fetch(
        game.channelId,
      );

    if (
      channel &&
      'messages' in channel
    ) {
      const message =
        await channel.messages.fetch(
          game.messageId,
        );

      const rows =
        createGameRows(game);

      rows.forEach(row => {
        row.components.forEach(
          component => {
            component.setDisabled(true);
          },
        );
      });

      await message.edit({
        embeds: [embed],
        components: rows,
      });
    }
  } catch (error) {
    console.error(
      'Error updating Lights Out end display:',
      error,
    );
  }

  lightsOutGames.delete(gameId);
}

function pushHistory(
  game: LightsOutGame,
): void {
  if (
    game.history.length >=
    MAX_HISTORY
  ) {
    game.history.shift();
  }

  game.history.push(
    cloneGrid(game.grid),
  );
}

function restorePreviousState(
  game: LightsOutGame,
): boolean {
  const previous =
    game.history.pop();

  if (!previous) {
    return false;
  }

  game.grid =
    cloneGrid(previous);

  game.attempts =
    Math.max(0, game.attempts - 1);

  return true;
}

function resetGame(
  game: LightsOutGame,
): void {
  game.grid =
    cloneGrid(game.initialGrid);

  game.attempts = 0;
  game.hintsUsed = 0;
  game.history = [];
  game.startedAt = Date.now();
}

function findActiveGameForUser(
  userId: string,
): LightsOutGame | undefined {
  for (const game of lightsOutGames.values()) {
    if (
      game.userId === userId ||
      game.opponentId === userId
    ) {
      return game;
    }
  }

  return undefined;
}

function formatLeaderboard(
  entries: LeaderboardEntry[],
  requestingUserId: string,
): string {
  if (entries.length === 0) {
    return 'No completed games yet.';
  }

  const medals = [
    '🥇',
    '🥈',
    '🥉',
  ];

  return entries
    .map((entry, index) => {
      const isYou =
        entry.userId ===
        requestingUserId;

      const name =
        `<@${entry.userId}>`;

      const prefix =
        medals[index] ??
        `**${index + 1}.**`;

      const best =
        entry.stats.bestMoves ??
        '—';

      return `${prefix} ${name}${isYou ? ' **(You)**' : ''} — **${best} moves**`;
    })
    .join('\n');
}

async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const storedStats = await prisma.lightsOutStats.findMany({
    where: { wins: { gt: 0 } },
    orderBy: [
      { bestMoves: 'asc' },
      { wins: 'desc' },
    ],
  });

  return storedStats.map(stats => ({
    userId: stats.userId,
    stats: {
      userId: stats.userId,
      gamesPlayed: stats.gamesPlayed,
      wins: stats.wins,
      totalMoves: stats.totalMoves,
      bestMoves: stats.bestMoves,
      bestTimeMs: stats.bestTimeMs,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
      hintsUsed: stats.hintsUsed,
      perfectWins: stats.perfectWins,
      dailyWins: stats.dailyWins,
      challengesWon: stats.challengesWon,
      battlesWon: stats.battlesWon,
    },
  }));
}

function getAchievementLines(
  stats: LightsOutStats,
): string[] {
  const achievements: string[] = [];

  if (stats.wins >= 1) {
    achievements.push(
      '💡 **First Light** — Win your first game',
    );
  }

  if (stats.bestMoves !== null &&
      stats.bestMoves <= 15) {
    achievements.push(
      '⚡ **Speed Demon** — Solve in 15 moves or fewer',
    );
  }

  if (stats.perfectWins >= 1) {
    achievements.push(
      '🏆 **Perfect** — Solve optimally',
    );
  }

  if (stats.wins >= 100) {
    achievements.push(
      '👑 **Lights Out Master** — Win 100 games',
    );
  }

  if (stats.currentStreak >= 7 ||
      stats.bestStreak >= 7) {
    achievements.push(
      '🔥 **Streak Keeper** — Reach a 7-game streak',
    );
  }

  if (
    stats.hintsUsed === 0 &&
    stats.wins > 0
  ) {
    achievements.push(
      '🧠 **No Help Needed** — You have never used a hint',
    );
  }

  return achievements;
}

function createStatsEmbed(
  user: User,
): EmbedBuilder {
  const stats =
    getStats(user.id);

  const averageMoves =
    stats.gamesPlayed > 0
      ? (
          stats.totalMoves /
          stats.gamesPlayed
        ).toFixed(1)
      : '0';

  const bestTime =
    stats.bestTimeMs !== null
      ? formatTime(
          stats.bestTimeMs,
        )
      : '—';

  const achievements =
    getAchievementLines(stats);

  let description =
    `🎮 Games played: **${stats.gamesPlayed}**\n` +
    `🏆 Wins: **${stats.wins}**\n` +
    `🎯 Average moves: **${averageMoves}**\n` +
    `⭐ Best moves: **${
      stats.bestMoves ?? '—'
    }**\n` +
    `⏱️ Best time: **${bestTime}**\n` +
    `🔥 Current streak: **${stats.currentStreak}**\n` +
    `🔥 Best streak: **${stats.bestStreak}**\n` +
    `💡 Hints used: **${stats.hintsUsed}**\n` +
    `🏆 Perfect wins: **${stats.perfectWins}**\n` +
    `📅 Daily wins: **${stats.dailyWins}**\n` +
    `🔥 Challenges won: **${stats.challengesWon}**\n` +
    `⚔️ Battles won: **${stats.battlesWon}**`;

  if (achievements.length > 0) {
    description +=
      `\n\n### Achievements\n` +
      achievements.join('\n');
  }

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(
      `💡 Lights Out Stats — ${user.username}`,
    )
    .setDescription(description)
    .setThumbnail(
      user.displayAvatarURL(),
    )
    .setTimestamp();
}

async function createLeaderboardEmbed(
  userId: string,
): Promise<EmbedBuilder> {
  const leaderboard =
    await getLeaderboard();

  const topTen =
    leaderboard.slice(0, 10);

  let description =
    formatLeaderboard(
      topTen,
      userId,
    );

  const yourIndex =
    leaderboard.findIndex(
      entry =>
        entry.userId === userId,
    );

  if (
    yourIndex >= 10 &&
    yourIndex !== -1
  ) {
    const yourEntry =
      leaderboard[yourIndex];

    description +=
      `\n\n... \n\n` +
      `**Your rank:** #${yourIndex + 1}\n` +
      `**Your best:** ${
        yourEntry.stats.bestMoves
      } moves`;
  }

  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(
      '🏆 Lights Out Leaderboard',
    )
    .setDescription(
      description,
    )
    .setFooter({
      text: 'Ranked by best move count',
    })
    .setTimestamp();
}

async function startGame(
  interaction: ChatInputCommandInteraction,
  difficulty: Difficulty,
  mode: GameMode,
): Promise<void> {
  const userId =
    interaction.user.id;

  const stats = await loadStats(
    userId,
    interaction.guildId!,
  );

  const config =
    DIFFICULTIES[difficulty];

  const existingGame =
    findActiveGameForUser(userId);

  if (existingGame) {
    const embed =
      EmbedService.error(
        'Game Already Active',
        'You already have an active Lights Out game.',
      );

    await interaction.editReply({
      embeds: [embed],
    });

    return;
  }

  let seed: number | undefined;

  if (mode === 'daily') {
    seed = getDailySeed();
  }

  const grid =
    createSolvableGrid(
      config.size,
      seed,
    );

  const optimalMoves =
    getOptimalMoves(
      grid,
      config.size,
    );

  const gameId =
    createGameId(userId);

  const game: LightsOutGame = {
    gameId,
    userId,

    channelId:
      interaction.channelId,

    messageId: '',

    grid,
    initialGrid:
      cloneGrid(grid),

    size: config.size,
    difficulty,
    mode,

    attempts: 0,
    hintsUsed: 0,

    startedAt: Date.now(),

    gameActive: true,
    processing: false,
    page: 0,

    history: [],
    undoUsed: false,
    resetUsed: false,

    optimalMoves,

    seed,
  };

  const embed =
    createGameEmbed(game);

  const rows =
    createGameRows(game);

  const message =
    await interaction.editReply({
      embeds: [embed],
      components: rows,
    });

  game.messageId =
    message.id;

  lightsOutGames.set(
    gameId,
    game,
  );

  stats.gamesPlayed++;
  await saveStats(userId);

  const collector =
    message.createMessageComponentCollector(
      {
        componentType:
          ComponentType.Button,
        time: GAME_TIMEOUT,
      },
    );

  collector.on(
    'collect',
    async (
      i: ButtonInteraction,
    ) => {
      const currentGame =
        lightsOutGames.get(
          gameId,
        );

      if (
        !currentGame ||
        !currentGame.gameActive
      ) {
        await i.reply({
          content:
            'This game has ended.',
          ephemeral: true,
        });

        return;
      }

      if (
        i.user.id !== userId
      ) {
        await i.reply({
          content:
            'This is not your game!',
          ephemeral: true,
        });

        return;
      }

      const customId =
        i.customId;

      /*
       * Handle navigation buttons before setting processing.
       */
      const pagePrefix = `lo_page_${gameId}_`;

      if (customId.startsWith(pagePrefix)) {
        const page = Number.parseInt(
          customId.slice(pagePrefix.length),
          10,
        );

        if (!Number.isInteger(page) || page < 0 || page > 3) {
          await i.reply({
            content: 'Invalid board page.',
            ephemeral: true,
          });

          return;
        }

        currentGame.page = page;

        await i.update({
          embeds: [
            createGameEmbed(
              currentGame,
            ),
          ],
          components: createGameRows(currentGame),
        });

        return;
      }

      if (
        currentGame.processing
      ) {
        await i.reply({
          content:
            'Please wait for the previous move to finish.',
          ephemeral: true,
        });

        return;
      }

      currentGame.processing =
        true;

      try {
        if (
          customId ===
          `lo_quit_${gameId}`
        ) {
          await i.deferUpdate();

          await endGame(
            gameId,
            'quit',
            i.client,
          );

          collector.stop(
            'quit',
          );

          return;
        }

        if (
          customId ===
          `lo_hint_${gameId}`
        ) {
          const recommendedMove =
            getRecommendedMove(
              currentGame.grid,
              currentGame.size,
            );

          if (
            recommendedMove ===
            null
          ) {
            await i.reply({
              content:
                'I could not calculate a hint for this board.',
              ephemeral: true,
            });

            return;
          }

          currentGame.hintsUsed++;

          const stats =
            getStats(userId);

          stats.hintsUsed++;
          await saveStats(userId);

          const row =
            Math.floor(
              recommendedMove /
                currentGame.size,
            ) + 1;

          const col =
            (recommendedMove %
              currentGame.size) + 1;

          await i.reply({
            content:
              `💡 Try pressing **Row ${row}, Column ${col}**.`,
            ephemeral: true,
          });

          return;
        }

        if (
          customId ===
          `lo_undo_${gameId}`
        ) {
          if (currentGame.undoUsed) {
            await i.reply({ content: 'Undo can only be used once per game.', ephemeral: true });
            return;
          }
          const restored =
            restorePreviousState(
              currentGame,
            );

          if (!restored) {
            await i.reply({
              content:
                'There are no moves to undo.',
              ephemeral: true,
            });

            return;
          }

          currentGame.undoUsed = true;
          currentGame.processing = false;

          await i.update({
            embeds: [
              createGameEmbed(
                currentGame,
              ),
            ],
            components:
              createGameRows(
                currentGame,
              ),
          });

          return;
        }

        if (
          customId ===
          `lo_reset_${gameId}`
        ) {
          if (currentGame.resetUsed) {
            await i.reply({ content: 'Reset can only be used once per game.', ephemeral: true });
            return;
          }
          resetGame(
            currentGame,
          );

          currentGame.resetUsed = true;
          currentGame.processing = false;

          await i.update({
            embeds: [
              createGameEmbed(
                currentGame,
              ),
            ],
            components:
              createGameRows(
                currentGame,
              ),
          });

          return;
        }

        const prefix =
          `lo_${gameId}_`;

        if (
          !customId.startsWith(
            prefix,
          )
        ) {
          await i.deferUpdate();
          return;
        }

        const indexText =
          customId.slice(
            prefix.length,
          );

        const index =
          Number.parseInt(
            indexText,
            10,
          );

        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >=
            currentGame.grid.length
        ) {
          await i.reply({
            content:
              'Invalid move.',
            ephemeral: true,
          });

          return;
        }

        pushHistory(
          currentGame,
        );

        toggleLight(
          currentGame.grid,
          index,
          currentGame.size,
        );

        currentGame.attempts++;

        if (
          isSolved(
            currentGame.grid,
          )
        ) {
          await i.deferUpdate();

          await endGame(
            gameId,
            'win',
            i.client,
          );

          collector.stop(
            'win',
          );

          return;
        }

        currentGame.processing = false;

        await i.update({
          embeds: [
            createGameEmbed(
              currentGame,
            ),
          ],
          components:
            createGameRows(
              currentGame,
            ),
        });
      } catch (error) {
        console.error(
          'Error processing Lights Out interaction:',
          error,
        );

        if (!i.replied && !i.deferred) {
          await i.reply({
            content:
              'An error occurred while processing that move.',
            ephemeral: true,
          });
        }
      } finally {
        currentGame.processing =
          false;
      }
    },
  );

  collector.on(
    'end',
  async (_collected, reason) => {
      const currentGame =
        lightsOutGames.get(
          gameId,
        );

      if (
        reason === 'time' &&
        currentGame &&
        currentGame.gameActive
      ) {
        await endGame(
          gameId,
          'timeout',
          interaction.client,
        );
      }
    },
  );
}

async function handleDaily(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const existingWin = await prisma.lightsOutDailyWin.findUnique({
    where: {
      userId_dateKey: {
        userId: interaction.user.id,
        dateKey: getDateKey(),
      },
    },
  });

  if (existingWin) {
    await interaction.editReply({
      embeds: [
        EmbedService.info(
          'Daily Puzzle Complete',
          'You have already completed today’s Lights Out puzzle. Come back tomorrow for a new one.',
        ),
      ],
    });

    return;
  }

  const existingGame =
    findActiveGameForUser(
      interaction.user.id,
    );

  if (existingGame) {
    const embed =
      EmbedService.error(
        'Game Already Active',
        'Finish your current Lights Out game before starting another one.',
      );

    await interaction.editReply({
      embeds: [embed],
    });

    return;
  }

  await startGame(
    interaction,
    'normal',
    'daily',
  );

}

async function handleStats(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await loadStats(
    interaction.user.id,
    interaction.guildId!,
  );

  await interaction.editReply({
    embeds: [
      createStatsEmbed(
        interaction.user,
      ),
    ],
  });
}

async function handleLeaderboard(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.editReply({
    embeds: [
      await createLeaderboardEmbed(
        interaction.user.id,
      ),
    ],
  });
}

async function handleGameControl(
  interaction: ChatInputCommandInteraction,
  action: 'hint' | 'undo' | 'reset' | 'quit',
): Promise<void> {
  const game = findActiveGameForUser(interaction.user.id);

  if (!game || game.userId !== interaction.user.id) {
    await interaction.editReply({
      embeds: [EmbedService.error('No Active Game', 'You do not have an active Lights Out game.')],
    });
    return;
  }

  if (action === 'quit') {
    await endGame(game.gameId, 'quit', interaction.client);
    await interaction.editReply({ embeds: [EmbedService.info('Game Ended', 'Your Lights Out game has been ended.')] });
    return;
  }

  if (action === 'hint') {
    const move = getRecommendedMove(game.grid, game.size);
    if (move === null) {
      await interaction.editReply({ embeds: [EmbedService.error('No Hint Available', 'I could not calculate a hint for this board.')] });
      return;
    }

    game.hintsUsed++;
    getStats(game.userId).hintsUsed++;
    await saveStats(game.userId);
    const row = Math.floor(move / game.size) + 1;
    const column = (move % game.size) + 1;
    await interaction.editReply({ embeds: [EmbedService.info('💡 Hint', `Try pressing **Row ${row}, Column ${column}**.`)] });
    return;
  }

  if (action === 'undo') {
    if (game.undoUsed) {
      await interaction.editReply({ embeds: [EmbedService.warning('Undo Already Used', 'Undo can only be used once per game.')] });
      return;
    }
    if (!restorePreviousState(game)) {
      await interaction.editReply({ embeds: [EmbedService.warning('Nothing to Undo', 'There are no moves to undo.')] });
      return;
    }
    game.undoUsed = true;
  }

  if (action === 'reset') {
    if (game.resetUsed) {
      await interaction.editReply({ embeds: [EmbedService.warning('Reset Already Used', 'Reset can only be used once per game.')] });
      return;
    }
    resetGame(game);
    game.resetUsed = true;
  }

  await updateGameDisplay(game.gameId, interaction.client, game.page);
  await interaction.editReply({
    embeds: [EmbedService.success('Lights Out Updated', action === 'undo' ? 'Your last move was undone.' : 'Your board was reset.')],
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('lightsout')
    .setDescription(
      'Play the classic Lights Out puzzle game',
    )

    .addSubcommand(
      subcommand =>
        subcommand
          .setName('play')
          .setDescription(
            'Play a Lights Out puzzle',
          )
          .addStringOption(
            option =>
              option
                .setName('difficulty')
                .setDescription(
                  'Choose your difficulty',
                )
                .setRequired(false)
                .addChoices(
                  {
                    name: '🟢 Easy — 3×3',
                    value: 'easy',
                  },
                  {
                    name: '🟡 Normal — 4×4',
                    value: 'normal',
                  },
                  {
                    name: '🔴 Hard — 5×5',
                    value: 'hard',
                  },
                ),
          ),
    )

    .addSubcommand(
      subcommand =>
        subcommand
          .setName('daily')
          .setDescription(
            'Play today’s daily puzzle',
          ),
    )

    .addSubcommand(
      subcommand =>
        subcommand
          .setName('challenge')
          .setDescription(
            'Play a high-reward challenge puzzle',
          )
          .addStringOption(
            option =>
              option
                .setName('difficulty')
                .setDescription(
                  'Choose your challenge difficulty',
                )
                .setRequired(false)
                .addChoices(
                  {
                    name: '🟢 Easy — 3×3',
                    value: 'easy',
                  },
                  {
                    name: '🟡 Normal — 4×4',
                    value: 'normal',
                  },
                  {
                    name: '🔴 Hard — 5×5',
                    value: 'hard',
                  },
                ),
          ),
    )

    .addSubcommand(subcommand => subcommand.setName('hint').setDescription('Get a hint for your active game'))
    .addSubcommand(subcommand => subcommand.setName('undo').setDescription('Undo your last move'))
    .addSubcommand(subcommand => subcommand.setName('reset').setDescription('Reset your active board'))
    .addSubcommand(subcommand => subcommand.setName('quit').setDescription('Quit your active game'))

    .addSubcommand(
      subcommand =>
        subcommand
          .setName('stats')
          .setDescription(
            'View your Lights Out statistics',
          ),
    )

    .addSubcommand(
      subcommand =>
        subcommand
          .setName('leaderboard')
          .setDescription(
            'View the Lights Out leaderboard',
          ),
    )

    .addSubcommand(
      subcommand =>
        subcommand
          .setName('battle')
          .setDescription(
            'Challenge another player to Lights Out',
          )
          .addUserOption(
            option =>
              option
                .setName('opponent')
                .setDescription(
                  'The player you want to challenge',
                )
                .setRequired(true),
          ),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
  ) {
    try {
      await interaction.deferReply();

      const userId =
        interaction.user.id;

      await loadStats(
        userId,
        interaction.guildId!,
      );

      const subcommand =
        interaction.options.getSubcommand();

      /*
       * Information commands don't need a cooldown.
       */
      if (
        subcommand === 'stats'
      ) {
        await handleStats(
          interaction,
        );

        return;
      }

      if (
        subcommand ===
        'leaderboard'
      ) {
        await handleLeaderboard(
          interaction,
        );

        return;
      }

      if (subcommand === 'hint' || subcommand === 'undo' || subcommand === 'reset' || subcommand === 'quit') {
        await handleGameControl(interaction, subcommand);
        return;
      }

      /*
       * Check whether the player already has a game.
       */
      const activeGame =
        findActiveGameForUser(
          userId,
        );

      if (activeGame) {
        const embed =
          EmbedService.error(
            'Game Already Active',
            'You already have an active Lights Out game. Finish it before starting another.',
          );

        await interaction.editReply({
          embeds: [embed],
        });

        return;
      }

      const cooldown =
        await CooldownService.checkCooldown(
          userId,
          'lightsout',
        );

      if (
        cooldown !== null
      ) {
        const embed =
          EmbedService.error(
            'Cooldown Active',
            `You can play Lights Out again in ${cooldown}`,
          );

        await interaction.editReply({
          embeds: [embed],
        });

        return;
      }

      if (
        subcommand === 'play'
      ) {
        const difficulty =
          getDifficultyFromInteraction(
            interaction,
          );

        await startGame(
          interaction,
          difficulty,
          'classic',
        );

        await CooldownService.setCooldown(
          userId,
          'lightsout',
        );

        return;
      }

      if (
        subcommand === 'daily'
      ) {
        await handleDaily(
          interaction,
        );

        await CooldownService.setCooldown(
          userId,
          'lightsout',
        );

        return;
      }

      if (
        subcommand ===
        'challenge'
      ) {
        const difficulty =
          getDifficultyFromInteraction(
            interaction,
          );

        await startGame(
          interaction,
          difficulty,
          'challenge',
        );

        await CooldownService.setCooldown(
          userId,
          'lightsout',
        );

        return;
      }

      if (
        subcommand === 'battle'
      ) {
        const opponent =
          interaction.options.getUser(
            'opponent',
            true,
          );

        if (
          opponent.bot
        ) {
          const embed =
            EmbedService.error(
              'Invalid Opponent',
              'You cannot challenge a bot.',
            );

          await interaction.editReply({
            embeds: [embed],
          });

          return;
        }

        if (
          opponent.id === userId
        ) {
          const embed =
            EmbedService.error(
              'Invalid Opponent',
              'You cannot challenge yourself.',
            );

          await interaction.editReply({
            embeds: [embed],
          });

          return;
        }

        const opponentGame =
          findActiveGameForUser(
            opponent.id,
          );

        if (opponentGame) {
          const embed =
            EmbedService.error(
              'Opponent Busy',
              'That player already has an active Lights Out game.',
            );

          await interaction.editReply({
            embeds: [embed],
          });

          return;
        }

        /*
         * Battle mode requires an actual interactive invitation.
         * We create the challenge message here rather than trying
         * to start the game immediately.
         */
        const challengeId =
          `${userId}-${opponent.id}-${Date.now()}`;

        const acceptButton =
          new ButtonBuilder()
            .setCustomId(
              `lo_battle_accept_${challengeId}`,
            )
            .setLabel('⚔️ Accept')
            .setStyle(
              ButtonStyle.Success,
            );

        const declineButton =
          new ButtonBuilder()
            .setCustomId(
              `lo_battle_decline_${challengeId}`,
            )
            .setLabel('❌ Decline')
            .setStyle(
              ButtonStyle.Danger,
            );

        const row =
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              acceptButton,
              declineButton,
            );

        const embed =
          EmbedService.economy(
            '⚔️ Lights Out Battle',
            `<@${opponent.id}>, **${interaction.user.username}** has challenged you to a Lights Out battle!\n\n` +
              `You will both receive the same **5×5 puzzle**.\n` +
              `The first player to solve the puzzle wins.\n\n` +
              `Challenge expires in 60 seconds.`,
          )
            .setTimestamp();

        const message =
          await interaction.editReply({
            embeds: [embed],
            components: [row],
          });

        const collector =
          message.createMessageComponentCollector(
            {
              componentType:
                ComponentType.Button,
              time: 60_000,
            },
          );

        collector.on(
          'collect',
          async (
            buttonInteraction,
          ) => {
            if (
              buttonInteraction.user
                .id !==
              opponent.id
            ) {
              await buttonInteraction.reply(
                {
                  content:
                    'Only the challenged player can respond.',
                  ephemeral: true,
                },
              );

              return;
            }

            if (
              buttonInteraction.customId ===
              `lo_battle_decline_${challengeId}`
            ) {
              await buttonInteraction.update(
                {
                  embeds: [
                    EmbedService.error(
                      'Battle Declined',
                      `${opponent} declined the challenge.`,
                    ),
                  ],
                  components: [],
                },
              );

              collector.stop(
                'declined',
              );

              return;
            }

            if (
              buttonInteraction.customId ===
              `lo_battle_accept_${challengeId}`
            ) {
              await loadStats(
                opponent.id,
                interaction.guildId!,
              );

              /*
               * Both players need separate game state.
               *
               * We use the same initial board and create two
               * independent games/messages.
               */
              const battleSeed =
                randomSeed();

              const board =
                createSolvableGrid(
                  5,
                  battleSeed,
                );

              const optimal =
                getOptimalMoves(
                  board,
                  5,
                );

              const playerOneGameId =
                createGameId(
                  userId,
                );

              const playerTwoGameId =
                createGameId(
                  opponent.id,
                );

              const playerOneGame:
                LightsOutGame = {
                  gameId:
                    playerOneGameId,

                  userId,

                  opponentId:
                    opponent.id,

                  channelId:
                    interaction.channelId,

                  messageId:
                    message.id,

                  grid:
                    cloneGrid(board),

                  initialGrid:
                    cloneGrid(board),

                  size: 5,
                  difficulty:
                    'normal',
                  mode: 'battle',

                  attempts: 0,
                  hintsUsed: 0,

                  startedAt:
                    Date.now(),

                  gameActive: true,
                  processing: false,
                  page: 0,

                  history: [],
                  undoUsed: false,
                  resetUsed: false,

                  optimalMoves:
                    optimal,

                  seed:
                    battleSeed,

                  battleScores: {},
                };

                const playerTwoGame:
                  LightsOutGame = {
                  gameId:
                    playerTwoGameId,

                  userId:
                    opponent.id,

                  opponentId:
                    userId,

                  channelId:
                    interaction.channelId,

                  messageId:
                    '',

                  grid:
                    cloneGrid(board),

                  initialGrid:
                    cloneGrid(board),

                  size: 5,
                  difficulty:
                    'normal',
                  mode: 'battle',

                  attempts: 0,
                  hintsUsed: 0,

                  startedAt:
                    Date.now(),

                  gameActive: true,
                  processing: false,
                  page: 0,

                  history: [],
                  undoUsed: false,
                  resetUsed: false,

                  optimalMoves:
                    optimal,

                  seed:
                    battleSeed,

                  battleScores: {},
                };

                /*
                 * The challenge message itself becomes player one's
                 * game message. Player two receives a new message.
                 */
                const opponentEmbed =
                  createGameEmbed(
                    playerTwoGame,
                  );

                const opponentRows =
                  createGameRows(
                    playerTwoGame,
                  );

                const channel = interaction.channel;

                if (!channel?.isSendable()) {
                  await buttonInteraction.reply({
                    content:
                      'I cannot send the opponent’s battle board in this channel.',
                    ephemeral: true,
                  });

                  return;
                }

                const opponentMessage =
                  await channel.send({
                    content:
                      `<@${opponent.id}>`,
                    embeds: [
                      opponentEmbed,
                    ],
                    components:
                      opponentRows,
                  });

                if (
                  !opponentMessage
                ) {
                  await buttonInteraction.reply(
                    {
                      content:
                        'I could not create the battle board.',
                      ephemeral: true,
                    },
                  );

                  return;
                }

                playerTwoGame.messageId =
                  opponentMessage.id;

                /*
                 * Player one's challenge message gets converted
                 * into their game.
                 */
                await buttonInteraction.update(
                  {
                    embeds: [
                      createGameEmbed(
                        playerOneGame,
                      ),
                    ],
                    components:
                      createGameRows(
                        playerOneGame,
                      ),
                  },
                );

                lightsOutGames.set(
                  playerOneGameId,
                  playerOneGame,
                );

                lightsOutGames.set(
                  playerTwoGameId,
                  playerTwoGame,
                );

                getStats(
                  userId,
                ).gamesPlayed++;

                getStats(
                  opponent.id,
                ).gamesPlayed++;

                collector.stop(
                  'accepted',
                );

                startBattleCollector(
                  playerOneGame,
                  playerTwoGame,
                  interaction.client,
                );
              }
          },
        );

        collector.on(
          'end',
          async () => {
            /*
             * If it ended normally, don't overwrite the accepted
             * battle.
             */
            if (
              collector.endReason ===
              'accepted'
            ) {
              return;
            }

            try {
              await interaction.editReply(
                {
                  embeds: [
                    EmbedService.error(
                      'Challenge Expired',
                      'The Lights Out battle invitation expired.',
                    ),
                  ],
                  components: [],
                },
              );
            } catch {
              // Message may already have been deleted.
            }
          },
        );

        return;
      }

      const embed =
        EmbedService.error(
          'Unknown Mode',
          'Unknown Lights Out mode.',
        );

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error(
        'Error in Lights Out command:',
        error,
      );

      const embed =
        EmbedService.error(
          'Error',
          'An error occurred while running Lights Out.',
        );

      try {
        if (
          interaction.deferred ||
          interaction.replied
        ) {
          await interaction.editReply({
            embeds: [embed],
            components: [],
          });
        } else {
          await interaction.reply({
            embeds: [embed],
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error(
          'Could not send Lights Out error:',
          replyError,
        );
      }
    }
  },
};

function startBattleCollector(
  playerOneGame: LightsOutGame,
  playerTwoGame: LightsOutGame,
  client: Client,
): void {
  const games = [
    playerOneGame,
    playerTwoGame,
  ];

  const processBattleMove =
    async (
      game: LightsOutGame,
      interaction: ButtonInteraction,
    ) => {
      if (
        !game.gameActive
      ) {
        await interaction.reply({
          content:
            'This battle has ended.',
          ephemeral: true,
        });

        return;
      }

      if (
        interaction.user.id !==
        game.userId
      ) {
        await interaction.reply({
          content:
            'This is not your game board.',
          ephemeral: true,
        });

        return;
      }

      if (
        game.processing
      ) {
        await interaction.reply({
          content:
            'Please wait for your previous move.',
          ephemeral: true,
        });

        return;
      }

      game.processing = true;

      try {
        const customId =
          interaction.customId;

        if (
          customId ===
          `lo_quit_${game.gameId}`
        ) {
          await interaction.deferUpdate();

          await endBattle(
            games,
            game,
            null,
            client,
          );

          return;
        }

        if (
          customId ===
          `lo_hint_${game.gameId}`
        ) {
          const move =
            getRecommendedMove(
              game.grid,
              game.size,
            );

          if (move === null) {
            await interaction.reply(
              {
                content:
                  'No hint is available.',
                ephemeral: true,
              },
            );

            return;
          }

          game.hintsUsed++;

          const stats =
            getStats(
              game.userId,
            );

          stats.hintsUsed++;
          await saveStats(game.userId);

          const row =
            Math.floor(
              move / game.size,
            ) + 1;

          const col =
            (move % game.size) + 1;

          await interaction.reply(
            {
              content:
                `💡 Try **Row ${row}, Column ${col}**.`,
              ephemeral: true,
            },
          );

          return;
        }

        if (
          customId ===
          `lo_undo_${game.gameId}`
        ) {
          if (
            !restorePreviousState(
              game,
            )
          ) {
            await interaction.reply(
              {
                content:
                  'There are no moves to undo.',
                ephemeral: true,
              },
            );

            return;
          }

          game.processing = false;

          await interaction.update({
            embeds: [
              createGameEmbed(
                game,
              ),
            ],
            components:
              createGameRows(
                game,
              ),
          });

          return;
        }

        if (
          customId ===
          `lo_reset_${game.gameId}`
        ) {
          resetGame(game);

          game.processing = false;

          await interaction.update({
            embeds: [
              createGameEmbed(
                game,
              ),
            ],
            components:
              createGameRows(
                game,
              ),
          });

          return;
        }

        const prefix =
          `lo_${game.gameId}_`;

        if (
          !customId.startsWith(
            prefix,
          )
        ) {
          await interaction.deferUpdate();
          return;
        }

        const index =
          Number.parseInt(
            customId.slice(
              prefix.length,
            ),
            10,
          );

        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >=
            game.grid.length
        ) {
          await interaction.reply(
            {
              content:
                'Invalid move.',
              ephemeral: true,
            },
          );

          return;
        }

        pushHistory(game);

        toggleLight(
          game.grid,
          index,
          game.size,
        );

        game.attempts++;

        if (
          isSolved(game.grid)
        ) {
          await interaction.deferUpdate();

          await endBattle(
            games,
            game,
            interaction,
            client,
          );

          return;
        }

        game.processing = false;

        await interaction.update({
          embeds: [
            createGameEmbed(game),
          ],
          components:
            createGameRows(game),
        });
      } catch (error) {
        console.error(
          'Error processing battle move:',
          error,
        );

        if (
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content:
              'An error occurred while processing your move.',
            ephemeral: true,
          });
        }
      } finally {
        game.processing = false;
      }
    };

  for (const game of games) {
    void attachBattleCollector(
      game,
      processBattleMove,
      client,
    );
  }
}

async function attachBattleCollector(
  game: LightsOutGame,
  handler: (
    game: LightsOutGame,
    interaction: ButtonInteraction,
  ) => Promise<void>,
  client: Client,
): Promise<void> {
  try {
    const channel =
      await client.channels.fetch(
        game.channelId,
      );

    if (
      !channel ||
      !('messages' in channel)
    ) {
      return;
    }

    const message =
      await channel.messages.fetch(
        game.messageId,
      );

    const collector =
      message.createMessageComponentCollector(
        {
          componentType:
            ComponentType.Button,
          time: GAME_TIMEOUT,
        },
      );

    collector.on(
      'collect',
      async interaction => {
        await handler(
          game,
          interaction,
        );

        if (
          !game.gameActive
        ) {
          collector.stop(
            'game-ended',
          );
        }
      },
    );

    collector.on(
      'end',
      async () => {
        if (
          game.gameActive
        ) {
          const otherGame =
            game.opponentId
              ? gamesafeGetOpponent(
                  game,
                )
              : null;

          if (otherGame) {
            await endBattle(
              [game, otherGame],
              game,
              null,
              client,
            );
          } else {
            await endGame(
              game.gameId,
              'timeout',
              client,
            );
          }
        }
      },
    );
  } catch (error) {
    console.error(
      'Error attaching battle collector:',
      error,
    );
  }
}

function gamesafeGetOpponent(
  game: LightsOutGame,
): LightsOutGame | null {
  if (!game.opponentId) {
    return null;
  }

  for (const candidate of lightsOutGames.values()) {
    if (
      candidate.gameId !==
        game.gameId &&
      candidate.userId ===
        game.opponentId &&
      candidate.mode ===
        'battle'
    ) {
      return candidate;
    }
  }

  return null;
}

async function endBattle(
  games: LightsOutGame[],
  completedGame: LightsOutGame,
  _interaction: ButtonInteraction | null,
  client: Client,
): Promise<void> {
  const playerOne =
    games[0];

  const playerTwo =
    games[1];

  if (
    !playerOne ||
    !playerTwo
  ) {
    return;
  }

  if (
    !playerOne.gameActive &&
    !playerTwo.gameActive
  ) {
    return;
  }

  /*
   * Once one player solves the puzzle, the battle ends immediately.
   *
   * If someone quits, the other player wins.
   */
  let winner:
    | LightsOutGame
    | null = null;

  let loser:
    | LightsOutGame
    | null = null;

  if (
    isSolved(
      completedGame.grid,
    )
  ) {
    winner =
      completedGame;

    loser =
      completedGame ===
      playerOne
        ? playerTwo
        : playerOne;
  } else {
    winner =
      completedGame ===
      playerOne
        ? playerTwo
        : playerOne;

    loser =
      completedGame ===
      playerOne
        ? playerOne
        : playerTwo;
  }

  playerOne.gameActive =
    false;

  playerTwo.gameActive =
    false;

  const winnerStats =
    getStats(
      winner.userId,
    );

  winnerStats.wins++;
  winnerStats.battlesWon++;
  winnerStats.currentStreak++;

  winnerStats.bestStreak =
    Math.max(
      winnerStats.bestStreak,
      winnerStats.currentStreak,
    );

  winnerStats.totalMoves +=
    winner.attempts;

  if (
    winnerStats.bestMoves ===
      null ||
    winner.attempts <
      winnerStats.bestMoves
  ) {
    winnerStats.bestMoves =
      winner.attempts;
  }

  const loserStats =
    getStats(
      loser.userId,
    );

  loserStats.currentStreak =
    0;

  const reward = 600;

  try {
    await EconomyService.addCredits(
      winner.userId,
      reward,
      'Lights Out battle win',
      'LIGHTS_OUT_BATTLE',
    );
  } catch (error) {
    console.error(
      'Error awarding battle reward:',
      error,
    );
  }

  await Promise.all([
    saveStats(winner.userId),
    saveStats(loser.userId),
  ]);

  const winnerDescription =
    `🏆 **You won the Lights Out battle!**\n\n` +
    `Your moves: **${winner.attempts}**\n` +
    `Opponent moves: **${loser.attempts}**\n\n` +
    `💰 Reward: **${reward} credits**`;

  const loserDescription =
    `💔 **You lost the Lights Out battle.**\n\n` +
    `Your moves: **${loser.attempts}**\n` +
    `Opponent moves: **${winner.attempts}**`;

  for (const game of games) {
    const isWinner =
      game === winner;

    const embed =
      EmbedService.economy(
        isWinner
          ? '⚔️ Lights Out — Victory!'
          : '⚔️ Lights Out — Defeat',
        isWinner
          ? winnerDescription
          : loserDescription,
      )
        .setFooter({
          text: `Battle • Game ${game.gameId}`,
        })
        .setTimestamp();

    try {
      const channel =
        await client.channels.fetch(
          game.channelId,
        );

      if (
        channel &&
        'messages' in channel
      ) {
        const message =
          await channel.messages.fetch(
            game.messageId,
          );

        const rows =
          createGameRows(game);

        rows.forEach(row => {
          row.components.forEach(
            component => {
              component.setDisabled(
                true,
              );
            },
          );
        });

        await message.edit({
          embeds: [embed],
          components: rows,
        });
      }
    } catch (error) {
      console.error(
        'Error updating battle result:',
        error,
      );
    }

    lightsOutGames.delete(
      game.gameId,
    );
  }
}
