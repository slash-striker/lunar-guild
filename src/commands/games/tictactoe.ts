import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
  ChatInputCommandInteraction, Client, ComponentType, Message,
  SlashCommandBuilder, User, InteractionCollector,
} from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { withGameLock } from '../../services/game-lock.ts';
import prisma from '../../database/client.ts';

type Mark = 'X' | 'O';
type Board = Array<Mark | null>;
type EndReason = 'player1' | 'player2' | 'draw' | 'timeout' | 'quit';
interface TicTacToeGame {
  gameId: string; player1Id: string; player2Id: string; channelId: string; messageId: string;
  board: Board; currentPlayer: Mark; player1Mark: Mark; player2Mark: Mark; gameActive: boolean; moveCount: number;
  winningCells: number[]; startedAt: number; turnTimer?: ReturnType<typeof setTimeout>;
  turnExpiresAt: number;
  collector?: InteractionCollector<ButtonInteraction>;
}
interface MatchSeries { player1Id: string; player2Id: string; wins: Record<string, number>; draws: number; }

const GAME_TIMEOUT = 5 * 60 * 1000;
const TURN_TIMEOUT = 30 * 1000;
const WIN_REWARD = 100;
const games = new Map<string, TicTacToeGame>();
const activeByPlayer = new Map<string, string>();
const pendingChallenges = new Map<string, { challengerId: string; challengedId: string; expiresAt: number }>();
const seriesByPair = new Map<string, MatchSeries>();

export const WIN_PATTERNS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function checkWinner(board: Board): { winner: Mark; cells: number[] } | null {
  for (const cells of WIN_PATTERNS) {
    const [a, b, c] = cells;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], cells };
  }
  return null;
}
export function isBoardFull(board: Board): boolean { return board.every(Boolean); }
function pairKey(a: string, b: string): string { return [a, b].sort().join(':'); }
function mention(id: string): string { return `<@${id}>`; }
function getSeries(game: TicTacToeGame): MatchSeries {
  return seriesByPair.get(pairKey(game.player1Id, game.player2Id)) ?? {
    player1Id: game.player1Id, player2Id: game.player2Id, wins: {}, draws: 0,
  };
}
function resetTurnTimer(game: TicTacToeGame, client: Client): void {
  if (game.turnTimer) clearTimeout(game.turnTimer);
  game.turnExpiresAt = Date.now() + TURN_TIMEOUT;
  game.turnTimer = setTimeout(() => void endGame(game.gameId, 'timeout', client), TURN_TIMEOUT);
}
function createBoard(game: TicTacToeGame, rematch = false): ActionRowBuilder<ButtonBuilder>[] {
  return [0, 1, 2].map(row => new ActionRowBuilder<ButtonBuilder>().addComponents(
    [0, 1, 2].map(column => {
      const index = row * 3 + column;
      const value = game.board[index];
      return new ButtonBuilder().setCustomId(`ttt_cell_${game.gameId}_${index}`)
        .setLabel(value ?? '⬜')
        .setStyle(game.winningCells.includes(index) ? ButtonStyle.Success : value === 'X' ? ButtonStyle.Primary : value === 'O' ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(!game.gameActive || value !== null);
    }),
  )).concat([new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ttt_quit_${game.gameId}`).setLabel('🚪 Quit').setStyle(ButtonStyle.Danger).setDisabled(!game.gameActive),
  ), ...(rematch ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ttt_rematch_${game.gameId}`).setLabel('🔄 Rematch').setStyle(ButtonStyle.Primary),
  )] : [])]);
}
function description(game: TicTacToeGame): string {
  const series = getSeries(game);
  const remaining = Math.max(0, Math.ceil((game.turnExpiresAt - Date.now()) / 1000));
  return `${mention(game.player1Id)} (${game.player1Mark === 'X' ? '❌ X' : '⭕ O'}) vs ${mention(game.player2Id)} (${game.player2Mark === 'X' ? '❌ X' : '⭕ O'})\n\n` +
    `❌ **${series.wins[game.player1Id] ?? 0}**  |  ⭕ **${series.wins[game.player2Id] ?? 0}**  |  🤝 **${series.draws}**\n` +
    `🎮 Current turn: **${game.currentPlayer === game.player1Mark ? mention(game.player1Id) : mention(game.player2Id)}**\n` +
    `Move: **${game.moveCount}/9** · ⏱️ Turn limit: **${remaining}s**\n\nWin reward: **${WIN_REWARD} credits**`;
}
async function render(game: TicTacToeGame, client: Client, title = '❌⭕ Tic Tac Toe'): Promise<void> {
  const channel = await client.channels.fetch(game.channelId);
  if (channel && 'messages' in channel) {
    const message = await channel.messages.fetch(game.messageId);
    await message.edit({ embeds: [EmbedService.economy(title, description(game))], components: createBoard(game) });
  }
}
async function ensureStats(userId: string): Promise<void> {
  await prisma.user.upsert({ where: { discordId: userId }, update: {}, create: { discordId: userId, guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844' } });
  await prisma.ticTacToeStats.upsert({ where: { userId }, update: {}, create: { userId } });
}
async function startGame(interaction: ChatInputCommandInteraction | ButtonInteraction, opponent: User, message: Message, series?: MatchSeries): Promise<void> {
  const gameId = `${interaction.user.id}-${opponent.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const player1Mark: Mark = Math.random() < 0.5 ? 'X' : 'O';
  const game: TicTacToeGame = {
    gameId, player1Id: interaction.user.id, player2Id: opponent.id, channelId: interaction.channelId,
    messageId: message.id, board: Array(9).fill(null), currentPlayer: 'X',
    player1Mark, player2Mark: player1Mark === 'X' ? 'O' : 'X',
    gameActive: true, moveCount: 0, winningCells: [], startedAt: Date.now(), turnExpiresAt: Date.now() + TURN_TIMEOUT,
  };
  if (series) seriesByPair.set(pairKey(game.player1Id, game.player2Id), series);
  games.set(gameId, game); activeByPlayer.set(game.player1Id, gameId); activeByPlayer.set(game.player2Id, gameId);
  await render(game, interaction.client);
  resetTurnTimer(game, interaction.client);
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: GAME_TIMEOUT });
  game.collector = collector;
  collector.on('collect', button => withGameLock(gameId, button, async () => {
    const current = games.get(gameId);
    if (!current || !current.gameActive) {
      await button.reply({ content: 'This game has ended.', ephemeral: true });
      return;
    }
    if (button.user.id !== current.player1Id && button.user.id !== current.player2Id) {
      await button.reply({ content: 'This is not your game.', ephemeral: true });
      return;
    }
    if (button.customId === `ttt_quit_${gameId}`) {
      await button.deferUpdate(); await endGame(gameId, button.user.id === current.player1Id ? 'player2' : 'player1', interaction.client, true); return;
    }
    const match = button.customId.match(new RegExp(`^ttt_cell_${gameId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_([0-8])$`));
    if (!match) {
      await button.reply({ content: 'Invalid move.', ephemeral: true });
      return;
    }
    const index = Number(match[1]);
      const expectedPlayer = current.currentPlayer === current.player1Mark ? current.player1Id : current.player2Id;
    if (button.user.id !== expectedPlayer) {
      await button.reply({ content: 'It is not your turn.', ephemeral: true });
      return;
    }
    if (current.board[index] !== null) {
      await button.reply({ content: 'That cell is already taken.', ephemeral: true });
      return;
    }
    current.board[index] = current.currentPlayer; current.moveCount++;
    const winner = checkWinner(current.board);
    if (winner) { current.winningCells = winner.cells; await button.deferUpdate(); await endGame(gameId, winner.winner === current.player1Mark ? 'player1' : 'player2', interaction.client); return; }
    if (isBoardFull(current.board)) { await button.deferUpdate(); await endGame(gameId, 'draw', interaction.client); return; }
    current.currentPlayer = current.currentPlayer === 'X' ? 'O' : 'X'; resetTurnTimer(current, interaction.client);
    await button.deferUpdate(); await render(current, interaction.client);
  }));
  collector.on('end', () => { const current = games.get(gameId); if (current?.gameActive) void endGame(gameId, 'timeout', interaction.client); });
}
async function endGame(gameId: string, result: EndReason, client: Client, quit = false): Promise<void> {
  const game = games.get(gameId); if (!game || !game.gameActive) return;
  game.gameActive = false; if (game.turnTimer) clearTimeout(game.turnTimer); game.collector?.stop('ended');
  const winnerId = result === 'player1' ? game.player1Id : result === 'player2' ? game.player2Id : null;
  const series = getSeries(game);
  let reward = 0;
  if (winnerId) {
    series.wins[winnerId] = (series.wins[winnerId] ?? 0) + 1; reward = WIN_REWARD;
    await EconomyService.addCredits(winnerId, reward, 'Tic Tac Toe win', 'TICTACTOE');
  } else if (result === 'draw') series.draws++;
  seriesByPair.set(pairKey(game.player1Id, game.player2Id), series);
  await Promise.all([ensureStats(game.player1Id), ensureStats(game.player2Id)]);
  const updates = [
    { userId: game.player1Id, win: winnerId === game.player1Id, loss: winnerId === game.player2Id },
    { userId: game.player2Id, win: winnerId === game.player2Id, loss: winnerId === game.player1Id },
  ];
  for (const update of updates) {
    const stats = await prisma.ticTacToeStats.findUniqueOrThrow({ where: { userId: update.userId } });
    const streak = update.win ? stats.currentStreak + 1 : 0;
    await prisma.ticTacToeStats.update({ where: { userId: update.userId }, data: {
      gamesPlayed: { increment: 1 }, wins: { increment: update.win ? 1 : 0 }, losses: { increment: update.loss ? 1 : 0 },
      draws: { increment: result === 'draw' ? 1 : 0 }, totalCredits: { increment: update.win ? reward : 0 },
      currentStreak: streak, bestStreak: Math.max(stats.bestStreak, streak),
    } });
  }
  await prisma.ticTacToeGameHistory.create({ data: { player1Id: game.player1Id, player2Id: game.player2Id, winnerId, result, moves: game.moveCount, durationMs: Date.now() - game.startedAt, credits: reward } });
  const outcome = result === 'draw' ? `🤝 **Draw!**` : result === 'timeout' ? `⏰ **Time expired!**` : quit ? `🚪 **${mention(result === 'player1' ? game.player2Id : game.player1Id)} forfeited!**` : `🏆 **${mention(winnerId!)} wins!**`;
  await render(game, client, '❌⭕ Tic Tac Toe — Game Over');
  const channel = await client.channels.fetch(game.channelId);
  if (channel && 'messages' in channel) {
    const message = await channel.messages.fetch(game.messageId);
    await message.edit({ embeds: [EmbedService.economy('❌⭕ Tic Tac Toe — Game Over', `${outcome}\n\n${description(game)}\n\n💰 Reward: **${reward} credits**\n\nUse the button below to request a rematch.`)], components: createBoard(game, true) });
      const rematchCollector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
      let rematchRequester: string | undefined;
      rematchCollector.on('collect', button => withGameLock(`rematch-${gameId}`, button, async () => {
        if (button.customId !== `ttt_rematch_${gameId}`) return;
        if (button.user.id !== game.player1Id && button.user.id !== game.player2Id) {
          await button.reply({ content: 'Only the players can request a rematch.', ephemeral: true });
          return;
        }
        if (!rematchRequester) {
          rematchRequester = button.user.id;
          await button.reply({ content: `Rematch requested. ${mention(button.user.id === game.player1Id ? game.player2Id : game.player1Id)} must click Rematch within 60 seconds.`, ephemeral: true });
          return;
        }
        if (rematchRequester === button.user.id) {
          await button.reply({ content: 'You already requested a rematch.', ephemeral: true });
          return;
        }
        const nextSeries = getSeries(game);
        rematchCollector.stop('accepted');
        await button.update({ components: [] });
        await startGame(button, button.user.id === game.player1Id ? await client.users.fetch(game.player2Id) : await client.users.fetch(game.player1Id), message, nextSeries);
      }));
      rematchCollector.on('end', () => { rematchRequester = undefined; });
    }
  activeByPlayer.delete(game.player1Id); activeByPlayer.delete(game.player2Id); games.delete(gameId);
}
async function stats(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user') ?? interaction.user; await ensureStats(user.id);
  const data = await prisma.ticTacToeStats.findUniqueOrThrow({ where: { userId: user.id } });
  const rate = data.gamesPlayed ? ((data.wins / data.gamesPlayed) * 100).toFixed(1) : '0.0';
  await interaction.reply({ embeds: [EmbedService.info(`❌⭕ ${user.username}'s Tic Tac Toe Stats`, `Games played: **${data.gamesPlayed}**\nWins: **${data.wins}** · Losses: **${data.losses}** · Draws: **${data.draws}**\nWin rate: **${rate}%**\nCurrent streak: **${data.currentStreak}** · Best streak: **${data.bestStreak}**\nCredits earned: **${data.totalCredits.toLocaleString()}**`)] });
}
async function leaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const entries = await prisma.ticTacToeStats.findMany({ where: { gamesPlayed: { gte: 3 } }, orderBy: [{ wins: 'desc' }, { gamesPlayed: 'desc' }], take: 10 });
  const lines = entries.length ? entries.map((entry, index) => `${index + 1}. ${mention(entry.userId)} — **${entry.wins} wins**, ${entry.gamesPlayed} games`).join('\n') : 'No players have completed three games yet.';
  await interaction.reply({ embeds: [EmbedService.info('❌⭕ Tic Tac Toe Leaderboard', lines)] });
}

export default {
  data: new SlashCommandBuilder().setName('tictac').setDescription('Play Tic Tac Toe')
    .addStringOption(option => option.setName('action').setDescription('Choose an action').setRequired(false).addChoices(
      { name: 'Play', value: 'play' }, { name: 'Stats', value: 'stats' }, { name: 'Leaderboard', value: 'leaderboard' },
    ))
    .addUserOption(option => option.setName('opponent').setDescription('The player to challenge').setRequired(false))
    .addUserOption(option => option.setName('user').setDescription('User whose stats to view').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    const action = interaction.options.getString('action') ?? 'play';
    if (action === 'stats') return stats(interaction);
    if (action === 'leaderboard') return leaderboard(interaction);
    const opponent = interaction.options.getUser('opponent');
    if (!opponent) return interaction.reply({ embeds: [EmbedService.error('Opponent Required', 'Choose an opponent to challenge.')], ephemeral: true });
    if (opponent.bot || opponent.id === interaction.user.id || activeByPlayer.has(interaction.user.id) || activeByPlayer.has(opponent.id)) return interaction.reply({ embeds: [EmbedService.error('Invalid Challenge', 'That player or you already has an active game.')], ephemeral: true });
    await interaction.deferReply();
    const key = `${interaction.user.id}-${opponent.id}`;
    if (pendingChallenges.has(key)) return interaction.editReply({ embeds: [EmbedService.error('Pending Challenge', 'You already challenged this player.')] });
    seriesByPair.delete(pairKey(interaction.user.id, opponent.id));
    pendingChallenges.set(key, { challengerId: interaction.user.id, challengedId: opponent.id, expiresAt: Date.now() + 60_000 });
    const message = await interaction.editReply({ embeds: [EmbedService.economy('❌⭕ Tic Tac Toe Challenge', `${mention(interaction.user.id)} challenged ${mention(opponent.id)}!\n${mention(opponent.id)}, accept within 60 seconds.`)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ttt_accept_${key}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ttt_decline_${key}`).setLabel('❌ Decline').setStyle(ButtonStyle.Danger),
    )] });
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
      collector.on('collect', button => withGameLock(`challenge-${key}`, button, async () => {
        if (button.user.id !== opponent.id) {
          await button.reply({ content: 'This challenge is not for you.', ephemeral: true });
          return;
        }
      const pending = pendingChallenges.get(key);
      if (!pending || pending.expiresAt < Date.now()) {
        await button.update({ embeds: [EmbedService.error('Challenge Expired', 'This challenge has expired.')], components: [] });
        return;
      }
      pendingChallenges.delete(key); collector.stop();
      if (button.customId.endsWith(`decline_${key}`)) {
        await button.update({ embeds: [EmbedService.error('Challenge Declined', `${mention(opponent.id)} declined.`)], components: [] });
        return;
      }
      await button.update({ components: [] }); await startGame(interaction, opponent, message);
    }));
    collector.on('end', () => { pendingChallenges.delete(key); });
  },
};
