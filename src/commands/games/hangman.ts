import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  ModalSubmitInteraction,
  Message,
} from 'discord.js';

import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';

interface HangmanCategory {
  name: string;
  words: string[];
}

interface HangmanDifficulty {
  name: string;
  maxWrongGuesses: number;
  reward: number;
  hintPenalty: number;
}

interface HangmanLeaderboardEntry {
  userId: string;
  wins: number;
  losses: number;
  quits: number;
  timeouts: number;
  hintsUsed: number;
  creditsEarned: number;
}

interface HangmanGame {
  userId: string;
  channelId: string;
  messageId: string;

  word: string;
  category: string;
  difficulty: string;

  guessed: Set<string>;

  wrongGuesses: number;
  maxWrongGuesses: number;

  hintsUsed: number;
  maxHints: number;

  reward: number;
  hintPenalty: number;

  gameActive: boolean;
  processing: boolean;
}

const hangmanGames = new Map<string, HangmanGame>();

/*
 * Prevent multiple active games for the same user.
 *
 * userId -> gameId
 */
const activeUserGames = new Map<string, string>();

/*
 * In-memory leaderboard.
 *
 * Replace this with your database/service if you want
 * leaderboard data to survive bot restarts.
 */
const hangmanLeaderboard =
  new Map<string, HangmanLeaderboardEntry>();

const MAX_HINTS = 2;
const GAME_TIMEOUT = 10 * 60 * 1000;

/*
 * =========================
 * CATEGORIES
 * =========================
 */

const CATEGORIES: Record<string, HangmanCategory> = {
  general: {
    name: 'General',
    words: [
      'APPLE',
      'BANANA',
      'CHERRY',
      'DRAGON',
      'ELEPHANT',
      'FLOWER',
      'GUITAR',
      'HOUSE',
      'ISLAND',
      'JUNGLE',
      'LEMON',
      'LUNAR',
      'MOUNTAIN',
      'NEBULA',
      'OCEAN',
      'PIZZA',
      'QUANTUM',
      'RAINBOW',
      'SUNSET',
      'UMBRELLA',
      'VOLCANO',
      'WATER',
      'XYLOPHONE',
      'YACHT',
      'ZEBRA',
      'APPLE',
      'BALL',
      'BOOK',
      'CAKE',
      'CLOUD',
      'CLOCK',
      'DOOR',
      'DREAM',
      'FIRE',
      'FISH',
      'FLOWER',
      'HOUSE',
      'JUICE',
      'LIGHT',
      'MONEY',
      'MUSIC',
      'PAPER',
      'PHONE',
      'PLANT',
      'RAIN',
      'RIVER',
      'SCHOOL',
      'SHOES',
      'SMILE',
      'SNOW',
      'STAR',
      'STONE',
      'SUN',
      'TABLE',
      'TREE',
      'WATER',
      'WINDOW',

      // Medium
      'BANANA',
      'CHERRY',
      'DRAGON',
      'ELEPHANT',
      'FAMILY',
      'GUITAR',
      'ISLAND',
      'JUNGLE',
      'LEMON',
      'MARKET',
      'MIRROR',
      'MORNING',
      'MOUNTAIN',
      'OCEAN',
      'PENCIL',
      'PILLOW',
      'RAINBOW',
      'ROCKET',
      'SILVER',
      'SUNSET',
      'THUNDER',
      'UMBRELLA',
      'VILLAGE',
      'VOLCANO',
      'WEEKEND',
      'WHISPER',

      // Hard
      'ADVENTURE',
      'ATMOSPHERE',
      'CELEBRATION',
      'CHALLENGE',
      'COMMUNITY',
      'CONFUSION',
      'CREATURE',
      'DANGEROUS',
      'DISCOVERY',
      'EDUCATION',
      'EXPERIENCE',
      'FASCINATION',
      'IMAGINATION',
      'INFORMATION',
      'KNOWLEDGE',
      'LIBERATION',
      'MYSTERIOUS',
      'OPPORTUNITY',
      'PERCEPTION',
      'PHENOMENON',
      'REPUTATION',
      'SIGNIFICANT',
      'TEMPERATURE',
      'UNDERSTANDING',
      'UNEXPECTED',

    ],
  },

  animals: {
    name: 'Animals',
    words: [
      'ALLIGATOR',
      'BEAR',
      'CHEETAH',
      'DOLPHIN',
      'ELEPHANT',
      'FALCON',
      'GIRAFFE',
      'HAMSTER',
      'JAGUAR',
      'KANGAROO',
      'LION',
      'MONKEY',
      'OCTOPUS',
      'PENGUIN',
      'RABBIT',
      'SHARK',
      'TIGER',
      'TURTLE',
      'WHALE',
      'ZEBRA',
    ],
  },

  

  food: {
    name: 'Food',
    words: [
      // Easy
      'APPLE',
      'BACON',
      'BREAD',
      'CAKE',
      'CANDY',
      'CHEESE',
      'COOKIE',
      'CORN',
      'CREAM',
      'DONUT',
      'EGG',
      'FRIES',
      'GRAPE',
      'HONEY',
      'LEMON',
      'MANGO',
      'MILK',
      'ONION',
      'PEACH',
      'PEAR',
      'PIZZA',
      'RICE',
      'SOUP',
      'TOAST',
      'TOMATO',

      // Medium
      'AVOCADO',
      'BANANA',
      'BURGER',
      'BURRITO',
      'CARROT',
      'CHICKEN',
      'COCONUT',
      'GARLIC',
      'LASAGNA',
      'LETTUCE',
      'MEATBALL',
      'MUSHROOM',
      'NOODLES',
      'ORANGE',
      'PANCAKE',
      'PASTA',
      'POPCORN',
      'PRETZEL',
      'SANDWICH',
      'SAUSAGE',
      'SPINACH',
      'STRAWBERRY',
      'TACO',
      'WAFFLE',
      'WATERMELON',

      // Hard
      'ARTICHOKE',
      'ASPARAGUS',
      'BLUEBERRY',
      'BROCCOLI',
      'CASSEROLE',
      'CHOCOLATE',
      'CINNAMON',
      'CRANBERRY',
      'GUACAMOLE',
      'JALAPENO',
      'MOZZARELLA',
      'PINEAPPLE',
      'PISTACHIO',
      'POMEGRANATE',
      'PROSCIUTTO',
      'RASPBERRY',
      'SPAGHETTI',
      'TORTELLINI',
      'VINAIGRETTE',
      'ZUCCHINI',
      'QUESADILLA',
      'MACARONI',
      'MEDITERRANEAN',
      'CHEESEBURGER',
    ],
  },

  nature: {
    name: 'Nature',
    words: [
      // Easy
      'BEACH',
      'BUSH',
      'CLOUD',
      'DUST',
      'FIRE',
      'GRASS',
      'HILL',
      'LAKE',
      'LEAF',
      'MOON',
      'OCEAN',
      'PLANT',
      'RAIN',
      'ROCK',
      'SAND',
      'SKY',
      'SNOW',
      'STAR',
      'SUN',
      'TREE',
      'WAVE',
      'WIND',
      'WOOD',

      // Medium
      'CANYON',
      'DESERT',
      'FOREST',
      'GLACIER',
      'ISLAND',
      'JUNGLE',
      'MEADOW',
      'MOUNTAIN',
      'RAINBOW',
      'RIVER',
      'SUNSET',
      'THUNDER',
      'VALLEY',
      'VOLCANO',
      'WATERFALL',
      'WILDFLOWER',
      'EARTHQUAKE',
      'HURRICANE',
      'LIGHTNING',
      'TORNADO',
      'AVALANCHE',

      // Hard
      'ATMOSPHERE',
      'BIODIVERSITY',
      'CONSTELLATION',
      'ECOSYSTEM',
      'EVAPORATION',
      'GEOTHERMAL',
      'HABITAT',
      'HIBERNATION',
      'METEOROLOGY',
      'PRECIPITATION',
      'PHOTOSYNTHESIS',
      'POLLINATION',
      'SEDIMENTATION',
      'STALACTITE',
      'STALAGMITE',
      'SUBTERRANEAN',
      'THERMOSPHERE',
      'WILDERNESS',
      'CRYSTALLIZATION',
      'DEFORESTATION',
      'ECOSYSTEM',
      'BIOLUMINESCENCE',
    ],
  },

  technology: {
    name: 'Technology',
    words: [
      // Easy
      'APP',
      'BYTE',
      'CHIP',
      'CODE',
      'DATA',
      'DISK',
      'EMAIL',
      'FILE',
      'GAMES',
      'LINK',
      'LOGIN',
      'MOUSE',
      'PHONE',
      'SCREEN',
      'SERVER',
      'SOFTWARE',
      'TABLET',
      'WEB',
      'WIFI',
      'WINDOW',

      // Medium
      'COMPUTER',
      'DATABASE',
      'KEYBOARD',
      'MONITOR',
      'NETWORK',
      'PROCESSOR',
      'PROGRAM',
      'ROUTER',
      'SMARTPHONE',
      'STORAGE',
      'TERMINAL',
      'WEBSITE',
      'WIRELESS',
      'BLUETOOTH',
      'INTERNET',
      'JAVASCRIPT',
      'TYPESCRIPT',
      'ALGORITHM',
      'FIREWALL',
      'HARDWARE',
      'SOFTWARE',

      // Hard
      'ARTIFICIALINTELLIGENCE',
      'AUTHENTICATION',
      'BLOCKCHAIN',
      'CYBERSECURITY',
      'CRYPTOGRAPHY',
      'DATABASEMANAGEMENT',
      'ENCRYPTION',
      'INFRASTRUCTURE',
      'MICROPROCESSOR',
      'NEURALNETWORK',
      'PROGRAMMING',
      'QUANTUM',
      'QUANTUMCOMPUTING',
      'RECURSION',
      'SUPERCOMPUTER',
      'VIRTUALIZATION',
      'CYBERSECURITY',
      'DECRYPTION',
      'MULTITHREADING',
      'OPTIMIZATION',
      'POLYMORPHISM',
      'ASYNCHRONOUS',
      'INTEROPERABILITY',
      'AUTHORIZATION',
      'ENCAPSULATION',
    ],
  },

  complex: {
    name: 'Complex',
    words: [
      'QUANTUM',
      'SLASHSTRIKER',
      'ABERRATION',
      'ACCELERATION',
      'ALGORITHM',
      'AMBIGUOUS',
      'ANOMALOUS',
      'ARCHAEOLOGY',
      'ASTRONOMICAL',
      'ASYMMETRICAL',
      'BUREAUCRACY',
      'CATASTROPHE',
      'CHRONOLOGICAL',
      'CONFLAGRATION',
      'CONSCIOUSNESS',
      'CRYPTOGRAPHY',
      'DECONSTRUCTION',
      'DELIBERATION',
      'DIMENSIONAL',
      'DYSFUNCTIONAL',
      'ECCENTRICITY',
      'ELECTROMAGNETIC',
      'ENCRYPTION',
      'ENTANGLEMENT',
      'EQUILIBRIUM',
      'EXTRATERRESTRIAL',
      'FLUCTUATION',
      'GEOMETRICAL',
      'HYPERACTIVE',
      'HYPOTHESIS',
      'ILLUMINATION',
      'IMPOSSIBILITY',
      'INCOMPREHENSIBLE',
      'INCONSISTENCY',
      'INFRASTRUCTURE',
      'INTERDIMENSIONAL',
      'IRREGULARITY',
      'JUXTAPOSITION',
      'LABYRINTHINE',
      'MAGNIFICATION',
      'METAMORPHOSIS',
      'MULTIVERSAL',
      'NEUROLOGICAL',
      'OBSCURATION',
      'OMNIPOTENT',
      'PARADOXICAL',
      'PHENOMENON',
      'PHOTOSYNTHESIS',
      'POLYMORPHISM',
      'PROCRASTINATION',
      'PSYCHOLOGICAL',
      'QUINTESSENTIAL',
      'RECONNAISSANCE',
      'REFRACTION',
      'RELATIVITY',
      'SPECTROSCOPY',
      'SUBCONSCIOUS',
      'SUPERPOSITION',
      'SYNCHRONIZATION',
      'TELEPORTATION',
      'THEORETICAL',
      'TRANSFORMATION',
      'TRANSCENDENCE',
      'UNCHARACTERISTIC',
      'UNPREDICTABILITY',
      'VULNERABILITY',
      'XENOPHOBIA',
      'ZEPHYR',
    ],
  },

};

/*
 * =========================
 * DIFFICULTIES
 * =========================
 */

const DIFFICULTIES: Record<
  string,
  HangmanDifficulty
> = {
  easy: {
    name: 'Easy',
    maxWrongGuesses: 10,
    reward: 200,
    hintPenalty: 25,
  },

  medium: {
    name: 'Medium',
    maxWrongGuesses: 7,
    reward: 300,
    hintPenalty: 50,
  },

  hard: {
    name: 'Hard',
    maxWrongGuesses: 6,
    reward: 500,
    hintPenalty: 100,
  },

  extreme: {
    name: 'Extreme',
    maxWrongGuesses: 4,
    reward: 2000,
    hintPenalty: 150,
  },

};

/*
 * =========================
 * HELPERS
 * =========================
 */

function getRandomWord(category: string): string {
  const categoryData =
    CATEGORIES[category] ?? CATEGORIES.general;

  const words = categoryData.words;

  return words[
    Math.floor(Math.random() * words.length)
  ];
}

function getDisplayWord(
  word: string,
  guessed: Set<string>,
): string {
  return word
    .split('')
    .map((letter) =>
      guessed.has(letter) ? letter : '＿',
    )
    .join(' ');
}

function isWordGuessed(
  word: string,
  guessed: Set<string>,
): boolean {
  return word
    .split('')
    .every((letter) => guessed.has(letter));
}

function getRemainingLetters(
  word: string,
  guessed: Set<string>,
): string[] {
  return [
    ...new Set(
      word
        .split('')
        .filter((letter) => !guessed.has(letter)),
    ),
  ];
}

function getFinalReward(game: HangmanGame): number {
  return Math.max(
    25,
    game.reward -
      game.hintsUsed * game.hintPenalty,
  );
}

function getLeaderboardEntry(
  userId: string,
): HangmanLeaderboardEntry {
  let entry = hangmanLeaderboard.get(userId);

  if (!entry) {
    entry = {
      userId,
      wins: 0,
      losses: 0,
      quits: 0,
      timeouts: 0,
      hintsUsed: 0,
      creditsEarned: 0,
    };

    hangmanLeaderboard.set(userId, entry);
  }

  return entry;
}

function recordResult(
  game: HangmanGame,
  result:
    | 'win'
    | 'lose'
    | 'quit'
    | 'timeout',
) {
  const entry =
    getLeaderboardEntry(game.userId);

  entry.hintsUsed += game.hintsUsed;

  switch (result) {
    case 'win': {
      entry.wins++;

      const reward = getFinalReward(game);

      entry.creditsEarned += reward;
      break;
    }

    case 'lose':
      entry.losses++;
      break;

    case 'quit':
      entry.quits++;
      break;

    case 'timeout':
      entry.timeouts++;
      break;
  }
}

function getHangmanVisual(
  wrongGuesses: number,
): string {
  const stages = [
    `
  +---+
      |
      |
      |
      |
      |
=========
`,
    `
  +---+
  |   |
      |
      |
      |
      |
=========
`,
    `
  +---+
  |   |
  O   |
      |
      |
      |
=========
`,
    `
  +---+
  |   |
  O   |
  |   |
      |
      |
=========
`,
    `
  +---+
  |   |
  O   |
 /|   |
      |
      |
=========
`,
    `
  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========
`,
    `
  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========
`,
    `
  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========
`,
    `
  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========
`,
  ];

  return `\`\`\`${stages[
    Math.min(
      wrongGuesses,
      stages.length - 1,
    )
  ]}\`\`\``;
}

/*
 * =========================
 * COMPONENTS
 * =========================
 */

function createComponents(
  gameId: string,
  game: HangmanGame,
  disabled = false,
): ActionRowBuilder<any>[] {
  const firstHalf =
    'ABCDEFGHIJKLM'.split('');

  const secondHalf =
    'NOPQRSTUVWXYZ'.split('');

  function createLetterMenu(
    letters: string[],
    id: string,
  ): StringSelectMenuBuilder {
    return new StringSelectMenuBuilder()
      .setCustomId(
        `hm:${gameId}:letter:${id}`,
      )
      .setPlaceholder('Choose a letter')
      .setDisabled(disabled)
      .addOptions(
        letters.map((letter) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(letter)
            .setValue(letter)
            .setDescription(
              game.guessed.has(letter)
                ? 'Already guessed'
                : `Guess the letter ${letter}`,
            ),
        ),
      );
  }

  const letterRow1 =
    new ActionRowBuilder<StringSelectMenuBuilder>()
      .addComponents(
        createLetterMenu(
          firstHalf,
          '1',
        ),
      );

  const letterRow2 =
    new ActionRowBuilder<StringSelectMenuBuilder>()
      .addComponents(
        createLetterMenu(
          secondHalf,
          '2',
        ),
      );

  const buttonRow =
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `hm:${gameId}:HINT`,
          )
          .setLabel(
            `💡 Hint (${Math.max(
              0,
              game.maxHints -
                game.hintsUsed,
            )})`,
          )
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(
            disabled ||
              game.hintsUsed >=
                game.maxHints,
          ),

        new ButtonBuilder()
          .setCustomId(
            `hm:${gameId}:GUESS`,
          )
          .setLabel('📝 Guess Word')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),

        new ButtonBuilder()
          .setCustomId(
            `hm:${gameId}:LEADERBOARD`,
          )
          .setLabel('🏆 Leaderboard')
          .setStyle(ButtonStyle.Success)
          .setDisabled(disabled),

        new ButtonBuilder()
          .setCustomId(
            `hm:${gameId}:QUIT`,
          )
          .setLabel('🚪 Quit')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      );

  return [
    letterRow1,
    letterRow2,
    buttonRow,
  ];
}

/*
 * =========================
 * EMBEDS
 * =========================
 */

function createGameEmbed(
  gameId: string,
  game: HangmanGame,
  gameOver = false,
  result?:
    | 'win'
    | 'lose'
    | 'quit'
    | 'timeout',
) {
  let title = '🎯 Hangman';
  let description = '';

  if (!gameOver) {
    const remaining =
      game.maxWrongGuesses -
      game.wrongGuesses;

    description =
      `Guess the word!\n\n` +
      `${getHangmanVisual(
        game.wrongGuesses,
      )}\n` +
      `**Word:** ${getDisplayWord(
        game.word,
        game.guessed,
      )}\n\n` +
      `📚 **Category:** ${game.category}\n` +
      `⚔️ **Difficulty:** ${game.difficulty}\n` +
      `❤️ **Wrong guesses:** ${game.wrongGuesses}/${game.maxWrongGuesses}\n` +
      `🎯 **Remaining:** ${remaining}\n` +
      `💡 **Hints:** ${game.hintsUsed}/${game.maxHints}\n` +
      `💰 **Reward:** ${getFinalReward(game)} credits`;
  } else {
    title = '🎯 Hangman — Game Over';

    switch (result) {
      case 'win': {
        const finalReward =
          getFinalReward(game);

        description =
          `🎉 **You won!**\n\n` +
          `The word was **${game.word}**.\n\n` +
          `📚 **Category:** ${game.category}\n` +
          `⚔️ **Difficulty:** ${game.difficulty}\n` +
          `💡 **Hints used:** ${game.hintsUsed}\n` +
          `💰 You earned **${finalReward} credits**!\n\n` +
          getHangmanVisual(
            game.wrongGuesses,
          );

        break;
      }

      case 'lose':
        description =
          `😢 **You lost!**\n\n` +
          `The word was **${game.word}**.\n\n` +
          `📚 **Category:** ${game.category}\n` +
          `⚔️ **Difficulty:** ${game.difficulty}\n\n` +
          getHangmanVisual(
            game.wrongGuesses,
          );

        break;

      case 'quit':
        description =
          `🚪 **You quit the game.**\n\n` +
          `The word was **${game.word}**.\n\n` +
          `📚 **Category:** ${game.category}\n` +
          `⚔️ **Difficulty:** ${game.difficulty}`;

        break;

      case 'timeout':
        description =
          `⏰ **Game timed out.**\n\n` +
          `The word was **${game.word}**.\n\n` +
          `📚 **Category:** ${game.category}\n` +
          `⚔️ **Difficulty:** ${game.difficulty}`;

        break;
    }
  }

  return EmbedService.economy(
    title,
    description,
  )
    .setFooter({
      text: `Game ID: ${gameId}`,
    })
    .setTimestamp();
}

function createLeaderboardEmbed() {
  const entries = [
    ...hangmanLeaderboard.values(),
  ]
    .sort(
      (a, b) =>
        b.creditsEarned -
        a.creditsEarned,
    )
    .slice(0, 10);

  if (entries.length === 0) {
    return EmbedService.economy(
      '🏆 Hangman Leaderboard',
      'No Hangman games have been completed yet.',
    );
  }

  const lines = entries.map(
    (entry, index) => {
      const totalGames =
        entry.wins +
        entry.losses +
        entry.quits +
        entry.timeouts;

      const winRate =
        totalGames > 0
          ? (
              (entry.wins /
                totalGames) *
              100
            ).toFixed(1)
          : '0.0';

      return (
        `**${index + 1}.** <@${entry.userId}>\n` +
        `🏆 ${entry.wins} wins • ` +
        `❌ ${entry.losses} losses • ` +
        `📊 ${winRate}% win rate\n` +
        `💰 ${entry.creditsEarned} credits`
      );
    },
  );

  return EmbedService.economy(
    '🏆 Hangman Leaderboard',
    lines.join('\n\n'),
  ).setTimestamp();
}

/*
 * =========================
 * WORD GUESS MODAL
 * =========================
 */

function createWordGuessModal(
  gameId: string,
): ModalBuilder {
  const input =
    new TextInputBuilder()
      .setCustomId('word')
      .setLabel('What is the word?')
      .setPlaceholder(
        'Enter your full word guess',
      )
      .setStyle(
        TextInputStyle.Short,
      )
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(30);

  const row =
    new ActionRowBuilder<TextInputBuilder>()
      .addComponents(input);

  return new ModalBuilder()
    .setCustomId(
      `hm:${gameId}:WORD_MODAL`,
    )
    .setTitle('📝 Guess the Word')
    .addComponents(row);
}

/*
 * =========================
 * COMMAND
 * =========================
 */

export default {
  data: new SlashCommandBuilder()
    .setName('hangman')
    .setDescription(
      'Play a game of Hangman',
    )
    .addStringOption(
      (option) =>
        option
          .setName('category')
          .setDescription(
            'Choose a word category',
          )
          .setRequired(false)
          .addChoices(
            {
              name: '📚 General',
              value: 'general',
            },
            {
              name: '🐾 Animals',
              value: 'animals',
            },
            {
              name: '🍕 Food',
              value: 'food',
            },
            {
              name: '🌿 Nature',
              value: 'nature',
            },
            {
              name: '💻 Technology',
              value: 'technology',
            },
            {
              name: '🧠 Complex',
              value: 'complex',
            },
          ),
    )
    .addStringOption(
      (option) =>
        option
          .setName('difficulty')
          .setDescription(
            'Choose the difficulty',
          )
          .setRequired(false)
          .addChoices(
            {
              name: '🟢 Easy — 200 credits',
              value: 'easy',
            },
            {
              name: '🟡 Medium — 300 credits',
              value: 'medium',
            },
            {
              name: '🔴 Hard — 500 credits',
              value: 'hard',
            },
          ),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
  ) {
    try {
      await interaction.deferReply();

      const userId =
        interaction.user.id;

      /*
       * Prevent multiple active games.
       */
      const existingGameId =
        activeUserGames.get(userId);

      if (existingGameId) {
        const existingGame =
          hangmanGames.get(
            existingGameId,
          );

        if (
          existingGame &&
          existingGame.gameActive
        ) {
          await interaction.editReply({
            embeds: [
              EmbedService.error(
                'Game Already Active',
                `You already have an active Hangman game.\n\n` +
                  `🎯 **Game ID:** \`${existingGameId}\`\n` +
                  `📚 **Category:** ${existingGame.category}\n` +
                  `⚔️ **Difficulty:** ${existingGame.difficulty}`,
              ),
            ],
          });

          return;
        }

        activeUserGames.delete(
          userId,
        );
      }

      /*
       * Cooldown.
       */
      const cooldown =
        await CooldownService.checkCooldown(
          userId,
          'hangman',
        );

      if (cooldown !== null) {
        await interaction.editReply({
          embeds: [
            EmbedService.error(
              'Cooldown Active',
              `You can play Hangman again in ${cooldown}`,
            ),
          ],
        });

        return;
      }

      const category =
        interaction.options.getString(
          'category',
        ) ?? 'general';

      const difficulty =
        interaction.options.getString(
          'difficulty',
        ) ?? 'medium';

      const difficultyData =
        DIFFICULTIES[difficulty];

      const categoryData =
        CATEGORIES[category];

      if (
        !difficultyData ||
        !categoryData
      ) {
        await interaction.editReply({
          embeds: [
            EmbedService.error(
              'Invalid Settings',
              'The selected category or difficulty is invalid.',
            ),
          ],
        });

        return;
      }

      const gameId =
        `${userId}-${Date.now()}`;

      const game: HangmanGame = {
        userId,
        channelId:
          interaction.channelId,
        messageId: '',

        word:
          getRandomWord(category),

        category:
          categoryData.name,

        difficulty:
          difficultyData.name,

        guessed:
          new Set<string>(),

        wrongGuesses: 0,

        maxWrongGuesses:
          difficultyData.maxWrongGuesses,

        hintsUsed: 0,
        maxHints: MAX_HINTS,

        reward:
          difficultyData.reward,

        hintPenalty:
          difficultyData.hintPenalty,

        gameActive: true,
        processing: false,
      };

      const message =
        await interaction.editReply({
          embeds: [
            createGameEmbed(
              gameId,
              game,
            ),
          ],
          components:
            createComponents(
              gameId,
              game,
            ),
        });

      game.messageId =
        message.id;

      hangmanGames.set(
        gameId,
        game,
      );

      activeUserGames.set(
        userId,
        gameId,
      );

      await CooldownService.setCooldown(
        userId,
        'hangman',
      );

      const collector =
        message.createMessageComponentCollector(
          {
            time: GAME_TIMEOUT,

            filter:
              (componentInteraction) =>
                componentInteraction.user
                  .id === userId,
          },
        );

      collector.on(
        'collect',
        async (
          componentInteraction,
        ) => {
          const currentGame =
            hangmanGames.get(
              gameId,
            );

          if (
            !currentGame ||
            !currentGame.gameActive
          ) {
            if (
              !componentInteraction.replied &&
              !componentInteraction.deferred
            ) {
              await componentInteraction.reply(
                {
                  content:
                    '❌ This game has ended.',
                  ephemeral: true,
                },
              );
            }

            return;
          }

          if (
            currentGame.processing
          ) {
            await componentInteraction.reply(
              {
                content:
                  '⏳ Processing your previous action...',
                ephemeral: true,
              },
            );

            return;
          }

          currentGame.processing =
            true;

          try {
            /*
             * =========================
             * QUIT
             * =========================
             */

            if (
              componentInteraction.isButton() &&
              componentInteraction.customId ===
                `hm:${gameId}:QUIT`
            ) {
              await componentInteraction.deferUpdate();

              await endGame(
                gameId,
                'quit',
                collector,
                message,
              );

              return;
            }

            /*
             * =========================
             * LEADERBOARD
             * =========================
             */

            if (
              componentInteraction.isButton() &&
              componentInteraction.customId ===
                `hm:${gameId}:LEADERBOARD`
            ) {
              await componentInteraction.reply(
                {
                  embeds: [
                    createLeaderboardEmbed(),
                  ],
                  ephemeral: true,
                },
              );

              return;
            }

            /*
             * =========================
             * HINT
             * =========================
             */

            if (
              componentInteraction.isButton() &&
              componentInteraction.customId ===
                `hm:${gameId}:HINT`
            ) {
              await componentInteraction.deferUpdate();

              if (
                currentGame.hintsUsed >=
                currentGame.maxHints
              ) {
                await componentInteraction.followUp(
                  {
                    content:
                      '💡 You have already used all of your hints.',
                    ephemeral: true,
                  },
                );

                return;
              }

              const remainingLetters =
                getRemainingLetters(
                  currentGame.word,
                  currentGame.guessed,
                );

              if (
                remainingLetters.length ===
                0
              ) {
                return;
              }

              const hintedLetter =
                remainingLetters[
                  Math.floor(
                    Math.random() *
                      remainingLetters.length,
                  )
                ];

              currentGame.guessed.add(
                hintedLetter,
              );

              currentGame.hintsUsed++;

              await message.edit({
                embeds: [
                  createGameEmbed(
                    gameId,
                    currentGame,
                  ),
                ],
                components:
                  createComponents(
                    gameId,
                    currentGame,
                  ),
              });

              await componentInteraction.followUp(
                {
                  content:
                    `💡 **Hint:** The letter **${hintedLetter}** has been revealed!\n` +
                    `💰 Each hint reduces your reward by **${currentGame.hintPenalty} credits**.`,
                  ephemeral: true,
                },
              );

              /*
               * A hint can theoretically complete
               * the word, so check for a win.
               */
              if (
                isWordGuessed(
                  currentGame.word,
                  currentGame.guessed,
                )
              ) {
                await endGame(
                  gameId,
                  'win',
                  collector,
                  message,
                );
              }

              return;
            }

            /*
             * =========================
             * WORD GUESS MODAL
             * =========================
             */

            if (
              componentInteraction.isButton() &&
              componentInteraction.customId ===
                `hm:${gameId}:GUESS`
            ) {
              await componentInteraction.showModal(
                createWordGuessModal(
                  gameId,
                ),
              );

              let modal:
                | ModalSubmitInteraction
                | undefined;

              try {
                modal =
                  await componentInteraction.awaitModalSubmit(
                    {
                      time: 60_000,

                      filter:
                        (modalInteraction) =>
                          modalInteraction
                            .user.id ===
                            userId &&
                          modalInteraction
                            .customId ===
                            `hm:${gameId}:WORD_MODAL`,
                    },
                  );
              } catch {
                /*
                 * Modal timed out.
                 */
                return;
              }

              const latestGame =
                hangmanGames.get(
                  gameId,
                );

              if (
                !latestGame ||
                !latestGame.gameActive
              ) {
                if (
                  !modal.replied &&
                  !modal.deferred
                ) {
                  await modal.reply({
                    content:
                      '❌ This game has ended.',
                    ephemeral: true,
                  });
                }

                return;
              }

              const guess =
                modal.fields
                  .getTextInputValue(
                    'word',
                  )
                  .trim()
                  .toUpperCase();

              if (!guess) {
                await modal.reply({
                  content:
                    '❌ Please enter a word.',
                  ephemeral: true,
                });

                return;
              }

              if (
                guess ===
                latestGame.word
              ) {
                await modal.deferUpdate();

                /*
                 * Reveal the whole word.
                 */
                for (
                  const letter of latestGame.word
                ) {
                  latestGame.guessed.add(
                    letter,
                  );
                }

                await endGame(
                  gameId,
                  'win',
                  collector,
                  message,
                );

                return;
              }

              /*
               * Incorrect full-word guesses
               * count as TWO wrong guesses.
               */
              latestGame.wrongGuesses +=
                2;

              if (
                latestGame.wrongGuesses >=
                latestGame.maxWrongGuesses
              ) {
                await modal.deferUpdate();

                await endGame(
                  gameId,
                  'lose',
                  collector,
                  message,
                );

                return;
              }

              await modal.deferUpdate();

              await message.edit({
                embeds: [
                  createGameEmbed(
                    gameId,
                    latestGame,
                  ),
                ],
                components:
                  createComponents(
                    gameId,
                    latestGame,
                  ),
              });

              await modal.followUp({
                content:
                  '❌ Incorrect word guess! You lost **2 wrong guesses**.',
                ephemeral: true,
              });

              return;
            }

            /*
             * =========================
             * LETTER SELECT MENU
             * =========================
             */

            if (
              !componentInteraction.isStringSelectMenu()
            ) {
              await componentInteraction.reply(
                {
                  content:
                    '❌ Invalid game interaction.',
                  ephemeral: true,
                },
              );

              return;
            }

            if (
              componentInteraction.customId !==
                `hm:${gameId}:letter:1` &&
              componentInteraction.customId !==
                `hm:${gameId}:letter:2`
            ) {
              await componentInteraction.reply(
                {
                  content:
                    '❌ Invalid Hangman interaction.',
                  ephemeral: true,
                },
              );

              return;
            }

            const letter =
              componentInteraction
                .values[0]
                ?.toUpperCase();

            if (!letter) {
              await componentInteraction.reply(
                {
                  content:
                    '❌ Invalid letter.',
                  ephemeral: true,
                },
              );

              return;
            }

            /*
             * ALREADY GUESSED
             */

            if (
              currentGame.guessed.has(
                letter,
              )
            ) {
              await componentInteraction.reply(
                {
                  content:
                    '⚠️ You already guessed that letter!',
                  ephemeral: true,
                },
              );

              return;
            }

            /*
             * REGISTER GUESS
             */

            currentGame.guessed.add(
              letter,
            );

            if (
              !currentGame.word.includes(
                letter,
              )
            ) {
              currentGame.wrongGuesses++;
            }

            /*
             * WIN
             */

            if (
              isWordGuessed(
                currentGame.word,
                currentGame.guessed,
              )
            ) {
              await componentInteraction.deferUpdate();

              await endGame(
                gameId,
                'win',
                collector,
                message,
              );

              return;
            }

            /*
             * LOSE
             */

            if (
              currentGame.wrongGuesses >=
              currentGame.maxWrongGuesses
            ) {
              await componentInteraction.deferUpdate();

              await endGame(
                gameId,
                'lose',
                collector,
                message,
              );

              return;
            }

            /*
             * CONTINUE
             */

            await componentInteraction.update(
              {
                embeds: [
                  createGameEmbed(
                    gameId,
                    currentGame,
                  ),
                ],
                components:
                  createComponents(
                    gameId,
                    currentGame,
                  ),
              },
            );
          } catch (error) {
            console.error(
              'Error processing Hangman interaction:',
              error,
            );

            if (
              !componentInteraction.replied &&
              !componentInteraction.deferred
            ) {
              await componentInteraction.reply(
                {
                  content:
                    '❌ Something went wrong processing your action.',
                  ephemeral: true,
                },
              );
            }
          } finally {
            const game =
              hangmanGames.get(
                gameId,
              );

            if (game) {
              game.processing =
                false;
            }
          }
        },
      );

      /*
       * =========================
       * COLLECTOR END
       * =========================
       */

      collector.on(
        'end',
        async () => {
          const currentGame =
            hangmanGames.get(
              gameId,
            );

          if (
            !currentGame ||
            !currentGame.gameActive
          ) {
            return;
          }

          await endGame(
            gameId,
            'timeout',
            collector,
            message,
          );
        },
      );
    } catch (error) {
      console.error(
        'Error in hangman command:',
        error,
      );

      const embed =
        EmbedService.error(
          'Error',
          'An error occurred while starting the game.',
        );

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
    }
  },
};

/*
 * =========================
 * END GAME
 * =========================
 */

async function endGame(
  gameId: string,
  result:
    | 'win'
    | 'lose'
    | 'quit'
    | 'timeout',
  collector: any,
  message: Message,
) {
  const game =
    hangmanGames.get(gameId);

  if (
    !game ||
    !game.gameActive
  ) {
    return;
  }

  game.gameActive = false;

  /*
   * Remove active game immediately so
   * another /hangman cannot be started.
   */
  if (
    activeUserGames.get(
      game.userId,
    ) === gameId
  ) {
    activeUserGames.delete(
      game.userId,
    );
  }

  /*
   * Stop collector.
   */
  collector.stop(result);

  /*
   * Record leaderboard result.
   */
  recordResult(
    game,
    result,
  );

  /*
   * Reward winner.
   */
  if (result === 'win') {
    try {
      const finalReward =
        getFinalReward(game);

      await EconomyService.addCredits(
        game.userId,
        finalReward,
        'Hangman win',
        'HANGMAN',
      );
    } catch (error) {
      console.error(
        'Error rewarding Hangman winner:',
        error,
      );
    }
  }

  const embed =
    createGameEmbed(
      gameId,
      game,
      true,
      result,
    );

  try {
    await message.edit({
      embeds: [embed],
      components:
        createComponents(
          gameId,
          game,
          true,
        ),
    });
  } catch (error) {
    console.error(
      'Error updating Hangman end display:',
      error,
    );
  } finally {
    hangmanGames.delete(
      gameId,
    );
  }
}
