import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, Client, User } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { withGameLock } from '../../services/game-lock.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

interface MastermindGame {
  gameId: string;
  userId: string;
  channelId: string;
  messageId: string;
  secret: string[];
  attempts: number;
  maxAttempts: number;
  guesses: { guess: string[]; correctPosition: number; correctColor: number }[];
  currentGuess: string[];
  gameActive: boolean;
  difficulty: Difficulty;
  allowDuplicates: boolean;
  daily: boolean;
  speedrun: boolean;
  fee: number;
  startedAt: number;
  hintsUsed: number;
  opponentId?: string;
  turnUserId?: string;
}
type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
const DIFFICULTY = {
  easy: { length: 3, colors: 4, attempts: 10, reward: 300 },
  normal: { length: 4, colors: 6, attempts: 8, reward: 600 },
  hard: { length: 5, colors: 8, attempts: 8, reward: 1000 },
  expert: { length: 6, colors: 8, attempts: 7, reward: 2000 },
} as const;

const mastermindGames = new Map<string, MastermindGame>();
const activeByUser = new Map<string, string>();
const pendingChallenges = new Map<string, { challengerId: string; challengedId: string; expiresAt: number }>();

const COLORS = ['🔴', '🟢', '🔵', '🟡', '🟣', '🟠', '⚫', '⚪'];
const COLOR_NAMES = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];

function createSecret(difficulty: Difficulty, allowDuplicates: boolean, seed?: string): string[] {
  const { length, colors } = DIFFICULTY[difficulty];
  const secret: string[] = [];
  let state = seed ? [...seed].reduce((hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0), 7) : 0;
  while (secret.length < length) {
    state = seed ? ((state * 1664525 + 1013904223) >>> 0) : Math.floor(Math.random() * 0xffffffff);
    const color = COLORS[state % colors];
    if (allowDuplicates || !secret.includes(color)) secret.push(color);
  }
  return secret;
}

function evaluateGuess(secret: string[], guess: string[]): { correctPosition: number; correctColor: number } {
  let correctPosition = 0;
  let correctColor = 0;
  
  const secretCopy = [...secret];
  const guessCopy = [...guess];
  
  // Check for correct position
  for (let i = 0; i < secret.length; i++) {
    if (guessCopy[i] === secretCopy[i]) {
      correctPosition++;
      secretCopy[i] = '';
      guessCopy[i] = '';
    }
  }
  
  // Check for correct color but wrong position
  for (let i = 0; i < secret.length; i++) {
    if (guessCopy[i] !== '') {
      const index = secretCopy.indexOf(guessCopy[i]);
      if (index !== -1) {
        correctColor++;
        secretCopy[index] = '';
      }
    }
  }
  
  return { correctPosition, correctColor };
}

export default {
  data: new SlashCommandBuilder()
    .setName('mastermind')
    .setDescription('Play the Mastermind code-breaking game')
    .addStringOption(o => o.setName('mode').setDescription('What to do').addChoices(
      { name: 'Play', value: 'play' }, { name: 'Daily', value: 'daily' },
      { name: 'Speedrun', value: 'speedrun' }, { name: 'Stats', value: 'stats' },
      { name: 'Leaderboard', value: 'leaderboard' }, { name: 'Help', value: 'help' },
    ))
    .addUserOption(o => o.setName('opponent').setDescription('Challenge another player (acceptance starts a competitive game)').setRequired(false))
    .addStringOption(o => o.setName('difficulty').setDescription('Puzzle difficulty').addChoices(
      { name: 'Easy', value: 'easy' }, { name: 'Normal', value: 'normal' },
      { name: 'Hard', value: 'hard' }, { name: 'Expert', value: 'expert' },
    ))
    .addBooleanOption(o => o.setName('duplicates').setDescription('Allow duplicate colors')),

  async execute(interaction: ChatInputCommandInteraction) {
    let entryFeeCharged = false;
    let entryFeeUserId: string | undefined;
    try {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const requestedMode = interaction.options.getString('mode');
      const mode = requestedMode ?? 'play';
      const opponent = interaction.options.getUser('opponent');
      const difficulty = mode === 'daily'
        ? 'normal'
        : (interaction.options.getString('difficulty') ?? 'normal') as Difficulty;
      const allowDuplicates = mode === 'daily'
        ? true
        : interaction.options.getBoolean('duplicates') ?? false;

      if (opponent) {
        if (opponent.bot || opponent.id === userId) {
          return interaction.editReply({ embeds: [EmbedService.error('Invalid Opponent', opponent.bot ? 'You cannot challenge a bot.' : 'You cannot challenge yourself.')] });
        }
        if (activeByUser.has(opponent.id)) {
          return interaction.editReply({ embeds: [EmbedService.error('Opponent Busy', 'That player already has an active Mastermind game.')] });
        }
        if ([...pendingChallenges.values()].some(p => p.challengerId === userId && p.challengedId === opponent.id && p.expiresAt > Date.now())) {
          return interaction.editReply({ embeds: [EmbedService.error('Pending Challenge', 'You already have a pending challenge with this player.')] });
        }
        const challengeId = `${userId}-${opponent.id}-${Date.now()}`;
        pendingChallenges.set(challengeId, { challengerId: userId, challengedId: opponent.id, expiresAt: Date.now() + 60_000 });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`mm_accept_${challengeId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`mm_decline_${challengeId}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
        );
        const message = await interaction.editReply({
          embeds: [EmbedService.economy('🧠 Mastermind Challenge', `<@${opponent.id}>, ${interaction.user} challenged you to Mastermind.\n\nAccept to start a competitive game. The challenge expires in 60 seconds.`)],
          components: [row],
        });
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
        collector.on('collect', async i => {
          if (i.user.id !== opponent.id) return i.reply({ content: 'Only the challenged player can respond.', ephemeral: true });
          const pending = pendingChallenges.get(challengeId);
          if (!pending || pending.expiresAt < Date.now()) {
            pendingChallenges.delete(challengeId);
            return i.update({ embeds: [EmbedService.error('Challenge Expired', 'This challenge has expired.')], components: [] });
          }
          pendingChallenges.delete(challengeId);
          if (i.customId === `mm_decline_${challengeId}`) {
            collector.stop('declined');
            return i.update({ embeds: [EmbedService.error('Challenge Declined', `${opponent} declined the challenge.`)], components: [] });
          }
          await i.update({ embeds: [EmbedService.info('Challenge Accepted', `${opponent} accepted. Starting a shared game. Players take alternating turns; only the player who cracks the code receives the reward.`)], components: [] });
          await startMastermindGame(interaction, 'challenge', difficulty, allowDuplicates, opponent.id);
          collector.stop('accepted');
        });
        collector.on('end', async () => {
          if (pendingChallenges.delete(challengeId)) {
            try { await interaction.editReply({ embeds: [EmbedService.error('Challenge Expired', 'The challenge timed out.')], components: [] }); } catch {}
          }
        });
        return;
      }
      if (!requestedMode) return showMastermindHub(interaction);
      if (mode === 'help') return interaction.editReply({ embeds: [EmbedService.info('Mastermind Help', 'Build a code, then submit it. 🟢 means correct position and 🟡 means correct color in the wrong position. Use Clear or Undo to edit your guess. Difficulty changes code length, colors, attempts, and rewards.') ] });
      await ensureStats(userId);
      if (mode === 'stats' || mode === 'leaderboard') {
        if (mode === 'stats') {
          const s = await prisma.mastermindStats.findUnique({ where: { userId } });
          return interaction.editReply({ embeds: [EmbedService.info('🧠 Mastermind Stats', `Games: **${s?.gamesPlayed ?? 0}**\nWins: **${s?.gamesWon ?? 0}**\nBest attempts: **${s?.bestAttempts ?? '—'}**\nPerfect wins: **${s?.perfectWins ?? 0}**\nDaily wins: **${s?.dailyWins ?? 0}**\nSpeedrun wins: **${s?.speedrunWins ?? 0}**\nBest streak: **${s?.bestStreak ?? 0}**`)] });
        }
        const rows = await prisma.mastermindStats.findMany({ orderBy: [{ gamesWon: 'desc' }, { bestAttempts: 'asc' }], take: 10 });
        return interaction.editReply({ embeds: [EmbedService.info('🏆 Mastermind Leaderboard', rows.map((s, i) => `${i + 1}. <@${s.userId}> — **${s.gamesWon}** wins (best ${s.bestAttempts ?? '—'})`).join('\n') || 'No games played yet.')] });
      }
      if (activeByUser.has(userId)) return interaction.editReply({ embeds: [EmbedService.error('Game Already Active', 'Finish your current Mastermind game first.')] });
      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(userId, 'mastermind');
      if (cooldown !== null) {
        const embed = EmbedService.error(
          'Cooldown Active',
          `You can play Mastermind again in ${cooldown}`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      const fee = 25;
      const balance = await EconomyService.getBalance(userId);
      if (balance.wallet < fee) return interaction.editReply({ embeds: [EmbedService.error('Insufficient Funds', `Mastermind requires a ${fee}-credit entry fee.`)] });
      await EconomyService.removeCredits(userId, fee, 'Mastermind entry fee', 'MASTERMIND_FEE');
      entryFeeCharged = true;
      entryFeeUserId = userId;

      // Create game
      const gameId = `${userId}-${Date.now()}`;
          const game: MastermindGame = {
            gameId,
        userId,
        channelId: interaction.channelId,
        messageId: '',
        secret: createSecret(
          difficulty,
          allowDuplicates,
          mode === 'daily' ? new Date().toISOString().slice(0, 10) : undefined,
        ),
        attempts: 0,
        maxAttempts: DIFFICULTY[difficulty].attempts,
        guesses: [],
        currentGuess: [],
        gameActive: true,
        difficulty,
        allowDuplicates,
        daily: mode === 'daily',
        speedrun: mode === 'speedrun',
        fee: 25,
        startedAt: Date.now(),
        hintsUsed: 0,
      };
      activeByUser.set(userId, gameId);

      const embed = EmbedService.economy(
        '🧠 Mastermind',
        `Guess the secret ${game.secret.length}-color code! You have ${game.maxAttempts} attempts.\n\n🟢 = Correct color and position\n🟡 = Correct color, wrong position\n\nCurrent guess: ${game.currentGuess.join(' ')}\n\nClick color buttons to build your guess.`
      )
        .setFooter({ text: `Game ID: ${gameId}` })
        .setTimestamp();

      const rows = createButtonRows(game);

      const message = await interaction.editReply({ embeds: [embed], components: rows });
      game.messageId = message.id;
      mastermindGames.set(gameId, game);

      // Set cooldown
      await CooldownService.setCooldown(userId, 'mastermind');

      // Create collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: game.speedrun ? 120000 : 600000,
      });

      collector.on('collect', (i) => withGameLock(gameId, i, async () => {
        if (i.user.id !== userId) {
          await i.reply({ content: 'This is not your game!', ephemeral: true });
          return;
        }

        const currentGame = mastermindGames.get(gameId);
        if (!currentGame || !currentGame.gameActive) {
          await i.reply({ content: 'This game has ended.', ephemeral: true });
          return;
        }

        if (i.customId.startsWith(`mm_color_${gameId}_`)) {
          const colorIndex = parseInt(i.customId.split('_')[3]);
          const color = COLORS[colorIndex];

          if (currentGame.currentGuess.length < currentGame.secret.length) {
            currentGame.currentGuess.push(color);
          }
          await i.deferUpdate();
          await updateGameDisplay(gameId, i.client);
        } else if (i.customId === `mm_submit_${gameId}`) {
          if (currentGame.currentGuess.length !== currentGame.secret.length) {
            await i.reply({ content: `You must select exactly ${currentGame.secret.length} colors!`, ephemeral: true });
            return;
          }

          await i.deferUpdate();
          const result = evaluateGuess(currentGame.secret, currentGame.currentGuess);
          currentGame.guesses.push({ guess: [...currentGame.currentGuess], ...result });
          currentGame.attempts++;
          currentGame.currentGuess = [];

          if (result.correctPosition === currentGame.secret.length) {
            await endGame(gameId, 'win', i.client);
          } else if (currentGame.attempts >= currentGame.maxAttempts) {
            await endGame(gameId, 'lose', i.client);
          } else {
            await updateGameDisplay(gameId, i.client);
          }
        } else if (i.customId === `mm_clear_${gameId}`) {
          currentGame.currentGuess = [];
          await i.deferUpdate();
          await updateGameDisplay(gameId, i.client);
        } else if (i.customId === `mm_reverse_${gameId}`) {
          if (currentGame.currentGuess.length > 0) {
            currentGame.currentGuess.pop();
          }
          await i.deferUpdate();
          await updateGameDisplay(gameId, i.client);
        } else if (i.customId === `mm_hint_${gameId}`) {
          if (currentGame.hintsUsed >= 2) {
            await i.reply({ content: 'You can use at most two hints per game.', ephemeral: true });
            return;
          }
          const hintBalance = await EconomyService.getBalance(userId);
          if (hintBalance.wallet < 100) {
            await i.reply({ content: 'You need 100 credits for a hint.', ephemeral: true });
            return;
          }
          await EconomyService.removeCredits(userId, 100, 'Mastermind hint', 'MASTERMIND_HINT');
          currentGame.hintsUsed++;
          const position = currentGame.hintsUsed - 1;
          const color = currentGame.secret[position];
          await i.reply({
            content: `💡 Hint: position ${position + 1} contains ${color}.`,
            ephemeral: true,
          });
          await updateGameDisplay(gameId, i.client);
        } else if (i.customId === `mm_quit_${gameId}`) {
          await endGame(gameId, 'quit', i.client);
          await i.deferUpdate();
          return;
        }
      }));

      collector.on('end', async () => {
        const currentGame = mastermindGames.get(gameId);
        if (currentGame && currentGame.gameActive) {
          await endGame(gameId, 'timeout', interaction.client);
        }
      });
    } catch (error) {
      console.error('Error in mastermind command:', error);
      if (entryFeeCharged && entryFeeUserId) {
        await EconomyService.addCredits(entryFeeUserId, 25, 'Refunded Mastermind entry fee', 'MASTERMIND_REFUND');
        activeByUser.delete(entryFeeUserId);
      }
      const embed = EmbedService.error('Error', 'An error occurred while starting the game.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

function createButtonRows(game: MastermindGame, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  const gameId = game.gameId;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Color buttons row 1 (first 3 colors)
  const colorRow1 = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < Math.min(3, DIFFICULTY[game.difficulty].colors); i++) {
    const button = new ButtonBuilder()
      .setCustomId(`mm_color_${gameId}_${i}`)
      .setLabel(COLORS[i])
      .setStyle(ButtonStyle.Primary).setDisabled(disabled);
    colorRow1.addComponents(button);
  }
  rows.push(colorRow1);

  // Color buttons row 2 (last 3 colors)
  const colorRow2 = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 3; i < DIFFICULTY[game.difficulty].colors; i++) {
    const button = new ButtonBuilder()
      .setCustomId(`mm_color_${gameId}_${i}`)
      .setLabel(COLORS[i])
      .setStyle(ButtonStyle.Primary).setDisabled(disabled);
    colorRow2.addComponents(button);
  }
  rows.push(colorRow2);

  // Action buttons row
  const actionRow = new ActionRowBuilder<ButtonBuilder>();
  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`mm_reverse_${gameId}`)
      .setLabel('↩️ Undo')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mm_clear_${gameId}`)
      .setLabel('🧹 Clear')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mm_submit_${gameId}`)
      .setLabel('✅ Submit Guess')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mm_hint_${gameId}`)
      .setLabel('💡 Hint (100)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`mm_quit_${gameId}`)
      .setLabel('🚪 Quit')
      .setStyle(ButtonStyle.Danger)
  );
  actionRow.components.forEach(button => button.setDisabled(disabled));
  rows.push(actionRow);

  return rows;
}

async function updateGameDisplay(gameId: string, client: Client) {
  const game = mastermindGames.get(gameId);
  if (!game) return;

  let description = `Guess the secret ${game.secret.length}-color code! Attempts: ${game.attempts}/${game.maxAttempts}\n\n`;
  description += `🟢 = Correct color and position\n🟡 = Correct color, wrong position\n\n`;
  description += `Current guess: ${game.currentGuess.join(' ')}\n\n`;
  description += '**Your guesses:**\n';

  game.guesses.forEach((g, i) => {
    description += `${i + 1}. ${g.guess.join('')} - 🟢 ${g.correctPosition} 🟡 ${g.correctColor}\n`;
  });

  const embed = EmbedService.economy('🧠 Mastermind', description)
    .setFooter({ text: `Game ID: ${gameId}` })
    .setTimestamp();

  const rows = createButtonRows(game);

  try {
    const channel = await client.channels.fetch(game.channelId);
    if (channel && 'messages' in channel) {
      const message = await channel.messages.fetch(game.messageId);
      await message.edit({ embeds: [embed], components: rows });
    }
  } catch (error) {
    console.error('Error updating mastermind display:', error);
  }
}

async function endGame(gameId: string, result: string, client: Client, winnerId = mastermindGames.get(gameId)?.userId) {
  const game = mastermindGames.get(gameId);
  if (!game) return;
  if (result === 'win' && !winnerId) return;

  game.gameActive = false;

  let description = '';
  const efficiencyMultiplier = game.attempts <= 2 ? 1.5 : game.attempts <= 4 ? 1.25 : game.attempts >= 7 ? 0.75 : 1;
  const baseReward = Math.max(0, Math.floor(DIFFICULTY[game.difficulty].reward * efficiencyMultiplier));
  const perfectBonus = game.attempts === 1 ? 500 : 0;
  const reward = result === 'win' ? baseReward + perfectBonus : 0;

  const rewardUserId = winnerId ?? game.userId;
  await ensureStats(rewardUserId);
  const storedStats = await prisma.mastermindStats.findUnique({ where: { userId: rewardUserId } });
  const achievements = new Set<string>(JSON.parse(storedStats?.achievements ?? '[]'));
  const winCount = (storedStats?.gamesWon ?? 0) + (result === 'win' ? 1 : 0);
  const streak = result === 'win' ? (storedStats?.currentStreak ?? 0) + 1 : 0;
  if (result === 'win') {
    if (winCount >= 1) achievements.add('First Crack');
    if (winCount >= 10) achievements.add('Codebreaker');
    if (winCount >= 100) achievements.add('Mastermind');
    if (streak >= 10) achievements.add('Unstoppable');
    if (game.attempts === 1) achievements.add('Perfect Game');
    if (game.difficulty === 'expert') achievements.add('Expert');
    if (game.hintsUsed === 0) achievements.add('Hintless');
    description = `🎉 You cracked the code! The secret was ${game.secret.join('')}. You win ${reward} credits!`;
    await EconomyService.addCredits(rewardUserId, reward, 'Mastermind win', 'MASTERMIND');
    await prisma.mastermindStats.update({ where: { userId: rewardUserId }, data: {
      gamesPlayed: { increment: 1 }, gamesWon: { increment: 1 }, totalAttempts: { increment: game.attempts },
      bestAttempts: { set: game.attempts }, fastestTimeMs: game.speedrun ? { set: Date.now() - game.startedAt } : undefined,
      perfectWins: game.attempts === 1 ? { increment: 1 } : undefined,
      dailyWins: game.daily ? { increment: 1 } : undefined, speedrunWins: game.speedrun ? { increment: 1 } : undefined,
    totalRewards: { increment: reward }, currentStreak: { set: streak }, bestStreak: { set: Math.max(storedStats?.bestStreak ?? 0, streak) },
    creditsSpent: { increment: game.fee + game.hintsUsed * 100 },
    hintsUsed: { increment: game.hintsUsed }, achievements: { set: JSON.stringify([...achievements]) },
    } });
  } else if (result === 'lose') {
    description = `😢 You ran out of attempts! The secret was ${game.secret.join('')}. Better luck next time!`;
  } else if (result === 'timeout') {
    description = `⏰ Game timed out! The secret was ${game.secret.join('')}.`;
  } else if (result === 'quit') {
    description = `🚪 You quit the game. The secret was ${game.secret.join('')}.`;
  }
  if (result !== 'win') {
    await prisma.mastermindStats.update({ where: { userId: game.userId }, data: {
      gamesPlayed: { increment: 1 }, totalAttempts: { increment: game.attempts }, currentStreak: { set: 0 },
      losses: result === 'lose' ? { increment: 1 } : undefined,
      timeouts: result === 'timeout' ? { increment: 1 } : undefined,
      quits: result === 'quit' ? { increment: 1 } : undefined,
      creditsSpent: { increment: game.fee + game.hintsUsed * 100 },
      hintsUsed: { increment: game.hintsUsed },
      achievements: { set: JSON.stringify([...achievements]) },
    } });
  }

  const embed = EmbedService.economy('🧠 Mastermind - Game Over', description)
    .setFooter({ text: `Game ID: ${gameId}` })
    .setTimestamp();

  const rows = createButtonRows(game);
  rows.forEach(row => row.components.forEach(btn => btn.setDisabled(true)));

  try {
    const channel = await client.channels.fetch(game.channelId);
    if (channel && 'messages' in channel) {
      const message = await channel.messages.fetch(game.messageId);
      await message.edit({ embeds: [embed], components: rows });
    }
  } catch (error) {
    console.error('Error updating mastermind end display:', error);
  }

  mastermindGames.delete(gameId);
  activeByUser.delete(game.userId);
  if (game.opponentId) activeByUser.delete(game.opponentId);
}

async function ensureStats(userId: string): Promise<void> {
  await prisma.user.upsert({ where: { discordId: userId }, update: {}, create: { discordId: userId, guildId: 'unknown' } });
  await prisma.mastermindStats.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function showMastermindHub(interaction: ChatInputCommandInteraction): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('mm_hub_play').setLabel('▶️ Play').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mm_hub_daily').setLabel('📅 Daily').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mm_hub_stats').setLabel('📊 Stats').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mm_hub_leaderboard').setLabel('🏆 Leaderboard').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mm_hub_help').setLabel('❓ Help').setStyle(ButtonStyle.Secondary),
  );
  const message = await interaction.editReply({ embeds: [EmbedService.info('🧠 Mastermind', 'Choose an option below. You can also use `/mastermind mode:<option>`.' )], components: [row] });
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) return i.reply({ content: 'This menu belongs to the player who opened it.', ephemeral: true });
    if (i.customId === 'mm_hub_stats' || i.customId === 'mm_hub_leaderboard' || i.customId === 'mm_hub_help') {
      await i.deferUpdate();
      if (i.customId === 'mm_hub_stats') {
        const s = await prisma.mastermindStats.findUnique({ where: { userId: i.user.id } });
        await interaction.editReply({ embeds: [EmbedService.info('🧠 Mastermind Stats', `Games: **${s?.gamesPlayed ?? 0}**\nWins: **${s?.gamesWon ?? 0}**\nBest attempts: **${s?.bestAttempts ?? '—'}**\nDaily wins: **${s?.dailyWins ?? 0}**\nSpeedrun wins: **${s?.speedrunWins ?? 0}**`)], components: [row] });
      } else if (i.customId === 'mm_hub_leaderboard') {
        const rows = await prisma.mastermindStats.findMany({ orderBy: [{ gamesWon: 'desc' }, { bestAttempts: 'asc' }], take: 10 });
        await interaction.editReply({ embeds: [EmbedService.info('🏆 Mastermind Leaderboard', rows.map((s, n) => `${n + 1}. <@${s.userId}> — **${s.gamesWon}** wins`).join('\n') || 'No games played yet.')], components: [row] });
      } else {
        await interaction.editReply({ embeds: [EmbedService.info('Mastermind Help', 'Build a code, then submit it. 🟢 is a correct position; 🟡 is a correct color in the wrong position.')], components: [row] });
      }
      return;
    }
    if (i.customId === 'mm_hub_play' || i.customId === 'mm_hub_daily') {
      await i.deferUpdate();
      collector.stop('started');
      const daily = i.customId === 'mm_hub_daily';
      await startMastermindGame(interaction, daily ? 'daily' : 'play', 'normal', daily);
    }
  });
  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      try { await interaction.editReply({ components: [] }); } catch {}
    }
  });
}

async function startMastermindGame(
  interaction: ChatInputCommandInteraction,
  mode: string,
  difficulty: Difficulty,
  allowDuplicates: boolean,
  opponentId?: string,
): Promise<void> {
  // Daily puzzles have a fixed ruleset so everyone solves the same challenge.
  if (mode === 'daily') {
    difficulty = 'normal';
    allowDuplicates = true;
  }
  const userId = interaction.user.id;
  await ensureStats(userId);
  if (activeByUser.has(userId)) return interaction.editReply({ embeds: [EmbedService.error('Game Already Active', 'Finish your current Mastermind game first.')] }).then(() => undefined);
  const cooldown = await CooldownService.checkCooldown(userId, 'mastermind');
  if (cooldown !== null) return interaction.editReply({ embeds: [EmbedService.error('Cooldown Active', `You can play Mastermind again in ${cooldown}`)] }).then(() => undefined);
  const fee = 25;
  const balance = await EconomyService.getBalance(userId);
  if (balance.wallet < fee) return interaction.editReply({ embeds: [EmbedService.error('Insufficient Funds', `Mastermind requires a ${fee}-credit entry fee.`)] }).then(() => undefined);
  await EconomyService.removeCredits(userId, fee, 'Mastermind entry fee', 'MASTERMIND_FEE');
  const gameId = `${userId}-${Date.now()}`;
  const game: MastermindGame = {
    gameId, userId, channelId: interaction.channelId, messageId: '',
    secret: createSecret(difficulty, allowDuplicates, mode === 'daily' ? new Date().toISOString().slice(0, 10) : undefined),
    attempts: 0, maxAttempts: DIFFICULTY[difficulty].attempts, guesses: [], currentGuess: [], gameActive: true,
    difficulty, allowDuplicates, daily: mode === 'daily', speedrun: mode === 'speedrun', fee, startedAt: Date.now(), hintsUsed: 0,
    opponentId, turnUserId: userId,
  };
  activeByUser.set(userId, gameId);
  if (opponentId) activeByUser.set(opponentId, gameId);
  const embed = EmbedService.economy('🧠 Mastermind', `Guess the secret ${game.secret.length}-color code! You have ${game.maxAttempts} attempts.\n\n🟢 = Correct position\n🟡 = Correct color, wrong position\n\nClick color buttons to build your guess.`).setFooter({ text: `Game ID: ${gameId}` }).setTimestamp();
  const message = await interaction.editReply({ embeds: [embed], components: createButtonRows(game) });
  game.messageId = message.id;
  mastermindGames.set(gameId, game);
  await CooldownService.setCooldown(userId, 'mastermind');
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: game.speedrun ? 120_000 : 600_000 });
  collector.on('collect', i => withGameLock(gameId, i, async () => {
    const current = mastermindGames.get(gameId);
    if (!current || !current.gameActive) { await i.reply({ content: 'This game has ended.', ephemeral: true }); return; }
    if (i.user.id !== userId && i.user.id !== current.opponentId) { await i.reply({ content: 'This is not your game!', ephemeral: true }); return; }
    if (current.opponentId && i.user.id !== current.turnUserId) { await i.reply({ content: 'Wait for the other player’s turn.', ephemeral: true }); return; }
    if (i.customId.startsWith(`mm_color_${gameId}_`)) {
      const index = Number(i.customId.split('_')[3]);
      if (!Number.isInteger(index) || index < 0 || index >= DIFFICULTY[difficulty].colors) { await i.reply({ content: 'Invalid color.', ephemeral: true }); return; }
      if (current.currentGuess.length < current.secret.length) current.currentGuess.push(COLORS[index]);
      await i.deferUpdate(); await updateGameDisplay(gameId, i.client); return;
    }
    if (i.customId === `mm_submit_${gameId}`) {
      if (current.currentGuess.length !== current.secret.length) { await i.reply({ content: `Select exactly ${current.secret.length} colors.`, ephemeral: true }); return; }
      await i.deferUpdate();
      const result = evaluateGuess(current.secret, current.currentGuess);
      current.guesses.push({ guess: [...current.currentGuess], ...result }); current.attempts++; current.currentGuess = [];
      if (result.correctPosition === current.secret.length) { await endGame(gameId, 'win', i.client, i.user.id); return; }
      if (current.attempts >= current.maxAttempts) { await endGame(gameId, 'lose', i.client); return; }
      if (current.opponentId) current.turnUserId = current.turnUserId === userId ? current.opponentId : userId;
      await updateGameDisplay(gameId, i.client); return;
    }
    if (i.customId === `mm_clear_${gameId}`) current.currentGuess = [];
    else if (i.customId === `mm_reverse_${gameId}`) current.currentGuess.pop();
    else if (i.customId === `mm_quit_${gameId}`) { await endGame(gameId, 'quit', i.client); await i.deferUpdate(); return; }
    else if (i.customId === `mm_hint_${gameId}`) {
      if (current.hintsUsed >= 2) { await i.reply({ content: 'You can use at most two hints per game.', ephemeral: true }); return; }
      const funds = await EconomyService.getBalance(i.user.id);
      if (funds.wallet < 100) { await i.reply({ content: 'You need 100 credits for a hint.', ephemeral: true }); return; }
      await EconomyService.removeCredits(i.user.id, 100, 'Mastermind hint', 'MASTERMIND_HINT'); current.hintsUsed++;
      await i.reply({ content: `💡 Position ${current.hintsUsed} contains ${current.secret[current.hintsUsed - 1]}.`, ephemeral: true });
      await updateGameDisplay(gameId, i.client); return;
    }
    await i.deferUpdate(); return updateGameDisplay(gameId, i.client);
  }));
  collector.on('end', () => { const current = mastermindGames.get(gameId); if (current?.gameActive) void endGame(gameId, 'timeout', interaction.client); });
}
