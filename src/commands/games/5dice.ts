import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionCollector,
  Message,
  SlashCommandBuilder,
} from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { withGameLock } from '../../services/game-lock.ts';
import prisma from '../../database/client.ts';

export type FiveDiceCombination =
  | 'Five of a Kind' | 'Four of a Kind' | 'Full House' | 'Three of a Kind'
  | 'Two Pairs' | 'One Pair' | 'No Match';

export interface FiveDiceResult {
  type: FiveDiceCombination;
  baseReward: number;
  scoreMultiplier: number;
}

export interface FiveDiceMultipliers {
  score: number;
  lucky: number;
  streak: number;
  daily: number;
}

interface FiveDiceStats {
  gamesPlayed: number;
  gamesWon: number;
  totalCredits: number;
  highestPayout: number;
  currentStreak: number;
  bestStreak: number;
  fiveOfAKind: number;
  fourOfAKind: number;
  fullHouses: number;
  achievements: string[];
  dailyDateKey: string | null;
  dailyCompleted: boolean;
}

interface FiveDiceGame {
  gameId: string;
  userId: string;
  channelId: string;
  messageId: string;
  dice: number[];
  kept: boolean[];
  rollsLeft: number;
  gameActive: boolean;
  daily: boolean;
  luckyRoll: boolean;
  payoutProcessed: boolean;
}

const DICE_COUNT = 5;
const SIDES = 6;
const TOTAL_ROLLS = 3;
const COLLECTOR_TIME_MS = 5 * 60 * 1000;
const LUCKY_ROLL_CHANCE = 0.05;
const LUCKY_MULTIPLIER = 1.5;
const DAILY_MULTIPLIER = 2;
const DAILY_WIN_BONUS = 500;
const STREAK_MULTIPLIERS = [1, 1.05, 1.1, 1.15, 1.25] as const;
const BASE_REWARDS: Record<FiveDiceCombination, number> = {
  'Five of a Kind': 1500,
  'Four of a Kind': 800,
  'Full House': 500,
  'Three of a Kind': 300,
  'Two Pairs': 200,
  'One Pair': 100,
  'No Match': 0,
};
const SCORE_MULTIPLIERS: Record<FiveDiceCombination, number> = {
  'Five of a Kind': 2,
  'Four of a Kind': 1.25,
  'Full House': 1.15,
  'Three of a Kind': 1.05,
  'Two Pairs': 1,
  'One Pair': 1,
  'No Match': 1,
};
const ACHIEVEMENTS: Record<string, string> = {
  first: '🏁 First Roll',
  lucky: '🍀 Lucky Roller',
  triple: '🎯 Triple Threat',
  full: '🏠 Full House',
  quad: '💎 Quad Master',
  yahtzee: '🎲 Yahtzee!',
  streak: '🔥 Hot Streak',
  high: '💰 High Roller',
};
const DICE_FACES = [
  '<:dice1:1544038673530622003>', '<:dice2:1544038674759417966>',
  '<:dice3:1544038676424556644>', '<:dice4:1544038677573804162>',
  '<:dice5:1544038691046031451>', '<:dice6:1544038692375502919>',
];
const games = new Map<string, FiveDiceGame>();

export function calculateScore(dice: number[]): FiveDiceResult {
  if (dice.length !== DICE_COUNT || dice.some(die => !Number.isInteger(die) || die < 1 || die > SIDES)) {
    throw new Error('Invalid dice state');
  }
  const counts = new Map<number, number>();
  dice.forEach(die => counts.set(die, (counts.get(die) ?? 0) + 1));
  const values = [...counts.values()].sort((a, b) => b - a);
  let type: FiveDiceCombination = 'No Match';
  if (values[0] === 5) type = 'Five of a Kind';
  else if (values[0] === 4) type = 'Four of a Kind';
  else if (values[0] === 3 && values[1] === 2) type = 'Full House';
  else if (values[0] === 3) type = 'Three of a Kind';
  else if (values.filter(value => value === 2).length === 2) type = 'Two Pairs';
  else if (values[0] === 2) type = 'One Pair';
  return { type, baseReward: BASE_REWARDS[type], scoreMultiplier: SCORE_MULTIPLIERS[type] };
}

export function getStreakMultiplier(streak: number): number {
  return STREAK_MULTIPLIERS[Math.min(Math.max(streak, 1), STREAK_MULTIPLIERS.length) - 1];
}

export function calculateReward(result: FiveDiceResult, multipliers: FiveDiceMultipliers): number {
  if (result.baseReward === 0) return 0;
  return Math.floor(
    result.baseReward * multipliers.score * multipliers.lucky *
    multipliers.streak * multipliers.daily,
  );
}

function dateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function rollDice(): number[] {
  return Array.from({ length: DICE_COUNT }, () => Math.floor(Math.random() * SIDES) + 1);
}

function formatDice(dice: number[], kept: boolean[]): string {
  return dice.map((die, index) => `${DICE_FACES[die - 1]}${kept[index] ? ' ✅' : ''}`).join('  ');
}

function getStatsDefaults(): FiveDiceStats {
  return {
    gamesPlayed: 0, gamesWon: 0, totalCredits: 0, highestPayout: 0,
    currentStreak: 0, bestStreak: 0, fiveOfAKind: 0, fourOfAKind: 0,
    fullHouses: 0, achievements: [], dailyDateKey: null, dailyCompleted: false,
  };
}

async function loadStats(userId: string): Promise<FiveDiceStats> {
  await CooldownService.getUserId(userId);
  const stats = await prisma.fiveDiceStats.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  let achievements: string[];
  try {
    const parsed: unknown = JSON.parse(stats.achievements);
    achievements = Array.isArray(parsed) && parsed.every(value => typeof value === 'string') ? parsed : [];
  } catch {
    achievements = [];
  }
  return { ...stats, achievements };
}

function createRows(game: FiveDiceGame, playAgainId?: string): ActionRowBuilder<ButtonBuilder>[] {
  const diceRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...game.dice.map((_, index) => new ButtonBuilder()
      .setCustomId(`fd_keep_${game.gameId}_${index}`)
      .setLabel(`${index + 1}${game.kept[index] ? ' ✅' : ''}`)
      .setStyle(game.kept[index] ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!game.gameActive)),
  );
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`fd_roll_${game.gameId}`).setLabel('Roll').setStyle(ButtonStyle.Primary)
      .setDisabled(!game.gameActive || game.rollsLeft === 0),
    new ButtonBuilder().setCustomId(`fd_finish_${game.gameId}`).setLabel('Finish').setStyle(ButtonStyle.Success)
      .setDisabled(!game.gameActive),
    new ButtonBuilder().setCustomId(`fd_quit_${game.gameId}`).setLabel('🚪 Quit').setStyle(ButtonStyle.Danger)
      .setDisabled(!game.gameActive),
  );
  const rows = [diceRow, actionRow];
  if (playAgainId) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`fd_again_${playAgainId}`).setLabel('🎲 Play Again').setStyle(ButtonStyle.Primary),
    ));
  }
  return rows;
}

function gameDescription(game: FiveDiceGame, stats: FiveDiceStats): string {
  const result = calculateScore(game.dice);
  const streak = stats.currentStreak + (result.baseReward > 0 ? 1 : 0);
  const potential = calculateReward(result, {
    score: result.scoreMultiplier,
    lucky: game.luckyRoll ? LUCKY_MULTIPLIER : 1,
    streak: getStreakMultiplier(streak),
    daily: game.daily ? DAILY_MULTIPLIER : 1,
  });
  return `${game.daily ? '🌟 **Daily Challenge**\n' : ''}Rolls remaining: **${game.rollsLeft}**\n\n` +
    `${formatDice(game.dice, game.kept)}\n\n` +
    `Current hand: **${result.type}**\nPotential reward: **${potential.toLocaleString()} credits**\n` +
    `Multipliers: ${result.scoreMultiplier}x score · ${game.luckyRoll ? `${LUCKY_MULTIPLIER}x lucky · ` : ''}` +
    `${getStreakMultiplier(streak)}x streak${game.daily ? ` · ${DAILY_MULTIPLIER}x daily` : ''}\n` +
    `Win streak: **${stats.currentStreak}**`;
}

async function startGame(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  daily: boolean,
): Promise<void> {
  const userId = interaction.user.id;
  const cooldownKey = daily ? 'fivedice-daily' : 'fivedice';
  const cooldown = await CooldownService.checkCooldown(userId, cooldownKey);
  if (cooldown !== null) {
    await interaction.reply({ embeds: [EmbedService.error('Cooldown Active', `You can play five dice again ${cooldown}.`)], ephemeral: true });
    return;
  }
  const stats = await loadStats(userId);
  if (daily && stats.dailyDateKey === dateKey() && stats.dailyCompleted) {
    await interaction.reply({ embeds: [EmbedService.error('Daily Challenge Complete', 'You have already completed today\'s challenge.')], ephemeral: true });
    return;
  }
  const gameId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const game: FiveDiceGame = {
    gameId, userId, channelId: interaction.channelId, messageId: '',
    dice: rollDice(), kept: new Array(DICE_COUNT).fill(false), rollsLeft: TOTAL_ROLLS - 1,
    gameActive: true, daily, luckyRoll: false, payoutProcessed: false,
  };
  const reply = interaction.deferred || interaction.replied
    ? await interaction.editReply({ embeds: [EmbedService.economy('🎲 Five Dice', gameDescription(game, stats))], components: createRows(game) })
    : await interaction.reply({ embeds: [EmbedService.economy('🎲 Five Dice', gameDescription(game, stats))], components: createRows(game), fetchReply: true });
  game.messageId = reply.id;
  games.set(gameId, game);
  const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: COLLECTOR_TIME_MS });
  collector.on('collect', button => withGameLock(gameId, button, async () => {
    if (button.user.id !== userId) {
      await button.reply({ content: 'This is not your game!', ephemeral: true });
      return;
    }
    const current = games.get(gameId);
    if (button.customId === `fd_again_${gameId}`) {
      if (current?.gameActive) return;
      games.delete(gameId);
      await startGame(button, daily);
      collector.stop('again');
      return;
    }
    if (!current || !current.gameActive) {
      await button.reply({ content: 'This game has ended.', ephemeral: true });
      return;
    }
    if (button.customId === `fd_roll_${gameId}`) {
      if (current.rollsLeft <= 0) {
        await button.reply({ content: 'No rolls left!', ephemeral: true });
        return;
      }
      current.dice = current.dice.map((die, index) => current.kept[index] ? die : Math.floor(Math.random() * SIDES) + 1);
      current.rollsLeft--;
      current.luckyRoll = current.luckyRoll || Math.random() < LUCKY_ROLL_CHANCE;
    } else if (button.customId.startsWith(`fd_keep_${gameId}_`)) {
      const match = button.customId.match(new RegExp(`^fd_keep_${gameId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_([0-4])$`));
      if (!match) {
        await button.reply({ content: 'Invalid dice selection.', ephemeral: true });
        return;
      }
      current.kept[Number(match[1])] = !current.kept[Number(match[1])];
    } else if (button.customId === `fd_finish_${gameId}`) {
      await button.deferUpdate();
      await endGame(gameId, button, collector);
      return;
    } else if (button.customId === `fd_quit_${gameId}`) {
      await button.deferUpdate();
      await endGame(gameId, button, collector, true);
      return;
    } else {
      return;
    }
    await button.deferUpdate();
    const currentStats = await loadStats(userId);
    await button.editReply({ embeds: [EmbedService.economy('🎲 Five Dice', gameDescription(current, currentStats))], components: createRows(current) });
  }));
  collector.on('end', async () => {
    const current = games.get(gameId);
    if (current?.gameActive) await endGame(gameId, reply, collector);
  });
}

async function endGame(
  gameId: string,
  interaction: ChatInputCommandInteraction | ButtonInteraction | Message,
  collector: InteractionCollector<ButtonInteraction>,
  quit = false,
): Promise<void> {
  const game = games.get(gameId);
  if (!game || !game.gameActive || game.payoutProcessed) return;
  game.gameActive = false;
  game.payoutProcessed = true;
  collector.stop?.(quit ? 'quit' : 'finished');
  const result = calculateScore(game.dice);
  const stats = await loadStats(game.userId);
  const won = !quit && result.baseReward > 0;
  const nextStreak = won ? stats.currentStreak + 1 : 0;
  const reward = won ? calculateReward(result, {
    score: result.scoreMultiplier, lucky: game.luckyRoll ? LUCKY_MULTIPLIER : 1,
    streak: getStreakMultiplier(nextStreak), daily: game.daily ? DAILY_MULTIPLIER : 1,
  }) + (game.daily ? DAILY_WIN_BONUS : 0) : 0;
  if (reward > 0) {
    try {
      await EconomyService.addCredits(game.userId, reward, 'Five dice win', 'FIVE_DICE');
    } catch (error) {
      console.error(`Five Dice payout failed for ${game.userId}`, error);
      games.delete(gameId);
      const errorEmbed = EmbedService.error('Payout Error', 'The reward could not be paid. Please contact an administrator.');
      if (interaction instanceof Message) await interaction.edit({ embeds: [errorEmbed], components: [] });
      else await interaction.editReply({ embeds: [errorEmbed], components: [] });
      return;
    }
  }
  const unlocked: string[] = [];
  const unlock = (key: string, condition: boolean) => {
    if (condition && !stats.achievements.includes(key)) {
      stats.achievements.push(key);
      unlocked.push(ACHIEVEMENTS[key]);
    }
  };
  unlock('first', stats.gamesPlayed === 0);
  unlock('lucky', game.luckyRoll);
  unlock('triple', result.type === 'Three of a Kind');
  unlock('full', result.type === 'Full House');
  unlock('quad', result.type === 'Four of a Kind');
  unlock('yahtzee', result.type === 'Five of a Kind');
  unlock('streak', nextStreak >= 5);
  unlock('high', stats.totalCredits + reward >= 5000);
  await prisma.fiveDiceStats.update({
    where: { userId: game.userId },
    data: {
      gamesPlayed: { increment: 1 }, gamesWon: { increment: won ? 1 : 0 },
      totalCredits: { increment: reward }, highestPayout: Math.max(stats.highestPayout, reward),
      currentStreak: nextStreak, bestStreak: Math.max(stats.bestStreak, nextStreak),
      fiveOfAKind: { increment: result.type === 'Five of a Kind' ? 1 : 0 },
      fourOfAKind: { increment: result.type === 'Four of a Kind' ? 1 : 0 },
      fullHouses: { increment: result.type === 'Full House' ? 1 : 0 },
      achievements: JSON.stringify(stats.achievements),
      ...(game.daily ? { dailyDateKey: dateKey(), dailyCompleted: true } : {}),
    },
  });
  await CooldownService.setCooldown(game.userId, game.daily ? 'fivedice-daily' : 'fivedice');
  const description = `${game.daily ? '🌟 **Daily Challenge**\n' : ''}Final dice:\n${formatDice(game.dice, game.kept)}\n\n` +
    `**${result.type}**\nBase reward: **${result.baseReward.toLocaleString()}**\n` +
    `${game.luckyRoll ? `Lucky Bonus: **${LUCKY_MULTIPLIER}x**\n` : ''}` +
    `Score multiplier: **${result.scoreMultiplier}x**\nStreak multiplier: **${won ? getStreakMultiplier(nextStreak) : '—'}**\n` +
    `${game.daily && won ? `Daily bonus: **${DAILY_WIN_BONUS.toLocaleString()}**\n` : ''}` +
    `\n💰 **Final Reward: ${reward.toLocaleString()} credits**\n🔥 Win Streak: **${nextStreak}**` +
    (unlocked.length ? `\n\n🏆 New achievements: ${unlocked.join(', ')}` : '');
  const rows = createRows(game, gameId);
  rows.slice(0, 2).forEach(row => row.components.forEach(button => button.setDisabled(true)));
  const payload = {
    embeds: [EmbedService.economy(`🎲 Five Dice — ${quit ? 'Quit' : 'Game Over'}`, description)],
    components: rows,
  };
  let gameMessage: Message;
  try {
    if (interaction instanceof Message) {
      gameMessage = await interaction.edit(payload);
    } else {
      gameMessage = await interaction.editReply(payload);
    }
  } finally {
    games.delete(gameId);
  }

  const replayCollector = gameMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIME_MS,
  });
  replayCollector.on('collect', button => withGameLock(`fivedice-replay-${gameId}`, button, async () => {
    if (button.customId !== `fd_again_${gameId}`) {
      await button.reply({ content: 'This game has ended.', ephemeral: true });
      return;
    }
    if (button.user.id !== game.userId) {
      await button.reply({ content: 'This is not your game!', ephemeral: true });
      return;
    }

    replayCollector.stop('replay');
    await startGame(button, game.daily);
  }));
  replayCollector.on('end', async () => {
    try {
      const disabledRows = createRows(game);
      await gameMessage.edit({ components: disabledRows });
    } catch (error) {
      console.error('Error disabling Five Dice replay button:', error);
    }
  });
}

async function showStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const stats = await loadStats(interaction.user.id);
  const achievements = stats.achievements.length ? stats.achievements.map(key => ACHIEVEMENTS[key]).join(', ') : 'None yet';
  await interaction.reply({ embeds: [EmbedService.economy('🎲 Five Dice Statistics',
    `Games played: **${stats.gamesPlayed}**\nGames won: **${stats.gamesWon}**\nTotal earned: **${stats.totalCredits.toLocaleString()}**\n` +
    `Highest payout: **${stats.highestPayout.toLocaleString()}**\nCurrent streak: **${stats.currentStreak}**\nBest streak: **${stats.bestStreak}**\n` +
    `Five of a Kind: **${stats.fiveOfAKind}**\nFour of a Kind: **${stats.fourOfAKind}**\nFull Houses: **${stats.fullHouses}**\n\nAchievements: ${achievements}`)], ephemeral: true });
}

export default {
  data: new SlashCommandBuilder()
    .setName('5dice')
    .setDescription('Play a Yahtzee-style dice game')
    .addSubcommand(command => command.setName('normal').setDescription('Play the standard Five Dice game'))
    .addSubcommand(command => command.setName('stats').setDescription('View your Five Dice statistics'))
    .addSubcommand(command => command.setName('daily').setDescription('Play today\'s Daily Challenge')),
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const subcommand = interaction.options.getSubcommand(false);
      if (subcommand === 'stats') return showStats(interaction);
      if (subcommand === 'daily') return startGame(interaction, true);
      if (subcommand === 'normal') return startGame(interaction, false);
      await startGame(interaction, false);
    } catch (error) {
      console.error('Error in fivedice command:', error);
      const response = EmbedService.error('Error', 'An error occurred while processing Five Dice.');
      if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [response], components: [] });
      else await interaction.reply({ embeds: [response], ephemeral: true });
    }
  },
};
