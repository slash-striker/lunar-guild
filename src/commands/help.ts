import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { EmbedService } from '../embeds/index.ts';

const HELP_SECTIONS: Record<string, { label: string; description: string; emoji: string; content: string }> = {
  getting_started: {
    label: 'Getting Started',
    description: 'The basics for new players',
    emoji: '🧭',
    content: '**Welcome to Lunar Bot!**\n\nStart with `/balance` to see your credits, then try `/daily` or `/work` to earn more. Use `/shop` to buy useful items and `/inventory` to see what you own.',
  },
  economy: {
    label: 'Economy',
    description: 'Earn, save, and spend credits',
    emoji: '💰',
    content: '`/balance` · `/bank` · `/daily` · `/work` · `/beg` · `/crime` · `/rob` · `/shop` · `/inventory` · `/cooldowns`\n\nFishing commands: `/fish`, `/fish-collection`, `/sell-fish`, and `/fishing-shop`.\n\nUse `/bank` to deposit or withdraw credits and `/cooldowns` to see when commands are ready again.',
  },
  games: {
    label: 'Games',
    description: 'Play games for credits',
    emoji: '🎮',
    content: '`/5dice` · `/blackjack` · `/hangman` · `/highlow` · `/lightsout` · `/mastermind` · `/matchpairs` · `/rps` · `/scratchcard` · `/tictac`\n\nMost games use buttons after starting. Keep your game buttons private to your game, and check `/cooldowns` if a game is unavailable.',
  },
  fivedice: {
    label: '5 Dice',
    description: 'Roll, keep dice, and chase multipliers',
    emoji: '🎲',
    content: '`/5dice` or `/5dice normal` starts the standard three-roll game. Keep or unkeep dice, then choose Roll, Finish, or Quit.\n`/5dice stats` shows wins, payouts, streaks, achievements, and combination counts.\n`/5dice daily` starts the UTC daily challenge with Normal rules, a separate cooldown, a daily multiplier, and a daily bonus.\n\nFive of a Kind, Four of a Kind, Full House, Three of a Kind, Two Pairs, and One Pair all pay differently. Lucky Rolls and win streaks can increase the final reward.',
  },
  blackjack: {
    label: 'Blackjack',
    description: 'Beat the dealer without going over 21',
    emoji: '🃏',
    content: '`/blackjack amount:<credits>` starts a hand. You may need to accept the rules first.\n**Hit** draws a card. **Stand** keeps your total. **Double** doubles the bet and draws exactly one card. **Split** appears for a matching opening pair, charges a second bet, and lets you play both hands separately.\n\nBlackjack pays 1.5x the bet. A push returns the bet. The dealer draws until 17 or higher.',
  },
  hangman: {
    label: 'Hangman',
    description: 'Guess the hidden word',
    emoji: '☠️',
    content: '`/hangman` starts a word puzzle.\n**Category** chooses the word theme. **Difficulty** changes the challenge. Use letter buttons to guess, and use the available game controls to manage the round.\n\nGuess carefully: incorrect letters use attempts, while solving the word earns the game reward.',
  },
  highlow: {
    label: 'High / Low',
    description: 'Predict whether the next card is higher or lower',
    emoji: '📈',
    content: '`/highlow` starts a card prediction game.\n**Bet** chooses your wager. **Mode** selects the available game style. **Preset** can choose a configured starting setup.\n\nChoose High or Low from the buttons. Your statistics, streaks, payouts, and achievements are saved. Use `/reset-highlow` only when an administrator needs to reset a player.',
  },
  lightsout: {
    label: 'Lights Out',
    description: 'Turn every light off',
    emoji: '💡',
    content: '`/lightsout play difficulty:<difficulty>` starts a puzzle. **Easy** is 3×3, **Normal** is 4×4, and **Hard** is 5×5.\n`/lightsout daily` plays the daily puzzle. `/lightsout challenge` starts a higher-reward challenge.\n\nDuring a game, **Hint**, **Undo**, **Reset**, and **Quit** are available. `/lightsout stats`, `/lightsout leaderboard`, and `/lightsout battle` show progression and competitive options.',
  },
  mastermind: {
    label: 'Mastermind',
    description: 'Break the hidden color code',
    emoji: '🧠',
    content: '`/mastermind mode:play` starts a normal game. **Difficulty** can be Easy, Normal, Hard, or Expert. **Duplicates** controls whether colors may repeat.\n`mode:daily` always uses Normal difficulty and duplicate colors. `mode:speedrun` gives you two minutes. `mode:stats`, `mode:leaderboard`, and `mode:help` show progress and guidance.\n\nUse color buttons, Undo, Clear, Submit Guess, Hint, and Quit. Green means the color and position are correct; yellow means the color is correct but misplaced.',
  },
  matchpairs: {
    label: 'Match Pairs',
    description: 'Find matching pairs',
    emoji: '🧩',
    content: '`/matchpairs` starts a memory matching game. Reveal two cards at a time and remember their positions.\n\nMatch every pair before you run out of attempts. Only the player who started the game can use its buttons.',
  },
  rps: {
    label: 'Rock Paper Scissors',
    description: 'Challenge another player',
    emoji: '✂️',
    content: '`/rps opponent:@user` sends a one-minute challenge. The challenged player can Accept or Decline.\n\nAfter accepting, choose Rock, Paper, or Scissors. Rock beats Scissors, Scissors beats Paper, and Paper beats Rock. Bots and self-challenges are not allowed.',
  },
  scratchcard: {
    label: 'Scratchcard',
    description: 'Reveal a quick random prize',
    emoji: '🎫',
    content: '`/scratchcard` buys and reveals a scratchcard. The result may award credits or a rare collectible.\n\nScratchcards have their own cooldown. The reward is determined server-side, so button or message data cannot change the outcome.',
  },
  tictac: {
    label: 'Tic Tac Toe',
    description: 'Challenge a player to a board game',
    emoji: '⭕',
    content: '`/tictac action:play opponent:@user` sends a 60-second challenge. After accepting, players alternate X and O on the board.\n`action:stats user:@user` shows lifetime statistics. `action:leaderboard` shows ranked players.\n\nA turn has a 30-second limit, games time out after five minutes, and completed games can offer a rematch. Winning cells are highlighted.',
  },
  items: {
    label: 'Items & Bonuses',
    description: 'Learn what shop items do',
    emoji: '🎒',
    content: '☕ **Coffee** helps your work shift.\n🥤 **Energy Drink** adds a work bonus.\n🎲 **Lucky Dice** improve your odds in eligible games and robberies.\n🐕 **Watchdogs** protect against robberies.\n📱 **Mobile Phones** notify owners when a bank robbery starts.\n\nMystery boxes open immediately and do not remain in your inventory.',
  },
  commands: {
    label: 'Useful Commands',
    description: 'Quick command reference',
    emoji: '📚',
    content: '`/help` — Open this guide\n`/lunar-info` — Post the detailed bot information embed (administrator only)\n`/level` — View your level\n`/leaderboard` — View rankings\n`/job-list` — View career progression\n`/job-apply` — Apply for an unlocked job\n\nGame-specific commands also include stats and leaderboard options where available.',
  },
};

function helpEmbed(section = 'getting_started'): EmbedBuilder {
  const selected = HELP_SECTIONS[section] ?? HELP_SECTIONS.getting_started;
  return EmbedService.info(
    `${selected.emoji} Lunar Bot Help — ${selected.label}`,
    `${selected.content}\n\nSelect another topic below to keep exploring.`,
  ).setFooter({ text: 'Lunar Guild Bot • Use /lunar-info for the public bot guide' });
}

function helpMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('lunar_help_topic')
      .setPlaceholder('Choose a help topic')
      .addOptions(Object.entries(HELP_SECTIONS).map(([value, section]) => ({
        label: section.label,
        description: section.description,
        value,
        emoji: section.emoji,
      }))),
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn how to use Lunar Guild Bot'),
  async execute(interaction: ChatInputCommandInteraction) {
    const message = await interaction.reply({
      embeds: [helpEmbed()],
      components: [helpMenu()],
      ephemeral: true,
      fetchReply: true,
    });
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 10 * 60 * 1000,
    });
    collector.on('collect', async (selection: StringSelectMenuInteraction) => {
      if (selection.user.id !== interaction.user.id) {
        await selection.reply({ content: 'This help menu belongs to someone else.', ephemeral: true });
        return;
      }
      await selection.update({
        embeds: [helpEmbed(selection.values[0])],
        components: [helpMenu()],
      });
    });
    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch (error) {
        console.error('Unable to close help menu:', error);
      }
    });
  },
};
