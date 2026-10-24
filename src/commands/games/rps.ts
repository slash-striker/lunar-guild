import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, User, ButtonInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import { withGameLock } from '../../services/game-lock.ts';

const CHOICES = ['rock', 'paper', 'scissors'] as const;
const EMOJIS = { rock: '🪨', paper: '📄', scissors: '✂️' };

interface RPSGame {
  player1Id: string;
  player2Id: string;
  channelId: string;
  messageId: string;
  player1Choice: typeof CHOICES[number] | null;
  player2Choice: typeof CHOICES[number] | null;
  gameActive: boolean;
}

const rpsGames = new Map<string, RPSGame>();
const pendingGames = new Map<string, { challengerId: string; challengedId: string; expiresAt: number }>();

export default {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play Rock Paper Scissors against another player')
    .addUserOption(option =>
      option.setName('opponent')
        .setDescription('The player to challenge')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const opponent = interaction.options.getUser('opponent', true);

      if (opponent.id === interaction.user.id) {
        const embed = EmbedService.error('Invalid Opponent', 'You cannot challenge yourself!');
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (opponent.bot) {
        const embed = EmbedService.error('Invalid Opponent', 'You cannot challenge a bot!');
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      await interaction.deferReply();

      // Check for existing pending game
      const pendingKey = `${interaction.user.id}-${opponent.id}`;
      if (pendingGames.has(pendingKey)) {
        const embed = EmbedService.error('Pending Challenge', 'You already have a pending challenge with this user.');
        return interaction.editReply({ embeds: [embed] });
      }

      // Create pending game
      pendingGames.set(pendingKey, {
        challengerId: interaction.user.id,
        challengedId: opponent.id,
        expiresAt: Date.now() + 60000, // 1 minute
      });

      const embed = EmbedService.economy(
        '🎮 Rock Paper Scissors Challenge',
        `${interaction.user} has challenged ${opponent} to a game of Rock Paper Scissors!\n\n` +
        `${opponent}, click "Accept" to start the game.`
      )
        .setFooter({ text: 'Challenge expires in 1 minute' })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`rps_accept_${pendingKey}`)
            .setLabel('✅ Accept')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`rps_decline_${pendingKey}`)
            .setLabel('❌ Decline')
            .setStyle(ButtonStyle.Danger)
        );

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // Create button collector
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== opponent.id) {
          await i.reply({ content: 'This challenge is not for you!', ephemeral: true });
          return;
        }

        const pending = pendingGames.get(pendingKey);
        if (!pending) {
          await i.reply({ content: 'This challenge has expired.', ephemeral: true });
          return;
        }

        if (i.customId === `rps_accept_${pendingKey}`) {
          pendingGames.delete(pendingKey);
          await startGame(interaction, opponent, message);
          await i.update({ components: [] });
        } else if (i.customId === `rps_decline_${pendingKey}`) {
          pendingGames.delete(pendingKey);
          const declineEmbed = EmbedService.error('Challenge Declined', `${opponent} declined the challenge.`);
          await i.update({ embeds: [declineEmbed], components: [] });
        }
      });

      collector.on('end', async () => {
        if (pendingGames.has(pendingKey)) {
          pendingGames.delete(pendingKey);
          try {
            const msg = await interaction.channel?.messages.fetch(message.id);
            if (msg) {
              const timeoutEmbed = EmbedService.error('Challenge Expired', 'The challenge timed out.');
              await msg.edit({ embeds: [timeoutEmbed], components: [] });
            }
          } catch (error) {
            console.error('Error cleaning up challenge message:', error);
          }
        }
      });
    } catch (error) {
      console.error('Error in rps command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while starting the game.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

async function startGame(interaction: ChatInputCommandInteraction, opponent: User, message: any) {
  const gameId = `${interaction.user.id}-${opponent.id}-${Date.now()}`;
  const game: RPSGame = {
    player1Id: interaction.user.id,
    player2Id: opponent.id,
    channelId: interaction.channelId,
    messageId: message.id,
    player1Choice: null,
    player2Choice: null,
    gameActive: true,
  };

  const embed = EmbedService.economy(
    '🎮 Rock Paper Scissors',
    `${interaction.user} vs ${opponent}\n\n` +
    `Both players must choose their move. Your choice is hidden until both have chosen!\n\n` +
    `Win to earn 50 credits!`
  )
    .setFooter({ text: `Game ID: ${gameId}` })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`rps_rock_${gameId}`)
        .setLabel('🪨 Rock')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rps_paper_${gameId}`)
        .setLabel('📄 Paper')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rps_scissors_${gameId}`)
        .setLabel('✂️ Scissors')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rps_quit_${gameId}`)
        .setLabel('� Quit')
        .setStyle(ButtonStyle.Danger)
    );

  await message.edit({ embeds: [embed], components: [row] });
  rpsGames.set(gameId, game);

  // Create button collector
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000, // 1 minute
  });

  collector.on('collect', (i: ButtonInteraction) => withGameLock(gameId, i, async () => {
    const currentGame = rpsGames.get(gameId);
    if (!currentGame || !currentGame.gameActive) {
      await i.reply({ content: 'This game has ended.', ephemeral: true });
      return;
    }

    if (i.user.id !== currentGame.player1Id && i.user.id !== currentGame.player2Id) {
      await i.reply({ content: 'This is not your game!', ephemeral: true });
      return;
    }

    if (i.customId === `rps_quit_${gameId}`) {
      await endGame(gameId, 'quit', i.client);
      await i.update({});
      return;
    }

    if (i.customId.startsWith(`rps_${gameId}_`)) {
      const choice = i.customId.split('_')[2] as typeof CHOICES[number];

      // Check if player already chose
      if (i.user.id === currentGame.player1Id && currentGame.player1Choice !== null) {
        await i.reply({ content: 'You have already made your choice!', ephemeral: true });
        return;
      }
      if (i.user.id === currentGame.player2Id && currentGame.player2Choice !== null) {
        await i.reply({ content: 'You have already made your choice!', ephemeral: true });
        return;
      }

      // Record choice
      if (i.user.id === currentGame.player1Id) {
        currentGame.player1Choice = choice;
      } else {
        currentGame.player2Choice = choice;
      }

      await i.reply({ content: 'Your choice has been recorded!', ephemeral: true });

      // Check if both players have chosen
      if (currentGame.player1Choice !== null && currentGame.player2Choice !== null) {
        await endGame(gameId, 'complete', i.client);
      }
    }
  }));

  collector.on('end', async () => {
    const currentGame = rpsGames.get(gameId);
    if (currentGame && currentGame.gameActive) {
      await endGame(gameId, 'timeout', interaction.client);
    }
  });
}

async function endGame(gameId: string, result: string, client: any) {
  const game = rpsGames.get(gameId);
  if (!game) return;

  game.gameActive = false;

  const player1Mention = `<@${game.player1Id}>`;
  const player2Mention = `<@${game.player2Id}>`;

  let description = '';

  if (result === 'complete' && game.player1Choice && game.player2Choice) {
    const choice1 = game.player1Choice;
    const choice2 = game.player2Choice;

    description = `${player1Mention} chose: ${EMOJIS[choice1]}\n`;
    description += `${player2Mention} chose: ${EMOJIS[choice2]}\n\n`;

    let winner: string | null = null;
    if (choice1 === choice2) {
      description += `**It's a tie!**`;
    } else if (
      (choice1 === 'rock' && choice2 === 'scissors') ||
      (choice1 === 'paper' && choice2 === 'rock') ||
      (choice1 === 'scissors' && choice2 === 'paper')
    ) {
      winner = game.player1Id;
      description += `**${player1Mention} wins!**`;
    } else {
      winner = game.player2Id;
      description += `**${player2Mention} wins!**`;
    }

    if (winner) {
      const reward = 50;
      await EconomyService.addCredits(winner, reward, 'RPS win', 'RPS');
      description += `\n\n🎉 They earn ${reward} credits!`;
    }
  } else if (result === 'timeout') {
    description = '⏰ Game timed out!';
  } else if (result === 'quit') {
    description = '🚪 The game was quit.';
  }

  const embed = EmbedService.economy('🎮 Rock Paper Scissors - Game Over', description)
    .setFooter({ text: `Game ID: ${gameId}` })
    .setTimestamp();

  const disabledRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('rps_rock')
        .setLabel('🪨 Rock')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('rps_paper')
        .setLabel('📄 Paper')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('rps_scissors')
        .setLabel('✂️ Scissors')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );

  try {
    const channel = await client.channels.fetch(game.channelId);
    if (channel && 'messages' in channel) {
      const message = await channel.messages.fetch(game.messageId);
      await message.edit({ embeds: [embed], components: [disabledRow] });
    }
  } catch (error) {
    console.error('Error updating RPS end display:', error);
  }

  rpsGames.delete(gameId);
}
