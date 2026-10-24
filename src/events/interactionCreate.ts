import { Events } from 'discord.js';
import { client, commands } from '../index.ts';
import { config } from '../config/index.ts';
import { EmbedService } from '../embeds/index.ts';
import { handleGiveawayJoinButton } from '../commands/admin/giveaway.ts';

const ECONOMY_CHANNEL_COMMANDS = new Set([
  'balance', 'bank', 'bankrob', 'beg', 'credits', 'crime', 'daily',
  'fish', 'fish-collection', 'fishing-shop', 'inventory', 'lottery',
  'job-apply', 'job-list', 'cooldowns', 'ec-leaderboard', 'ec-stats',
  'rob', 'sell-fish', 'shop', 'work',
  '5dice', 'blackjack', 'highlow', 'hangman', 'lightsout',
  'mastermind', 'matchpairs', 'rps', 'scratchcard', 'tictac',
]);

export default {
  name: Events.InteractionCreate,
  async execute(interaction: any) {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('giveaway_join:')) {
        await handleGiveawayJoinButton(interaction);
      }
      return;
    }
    // Handle autocomplete interactions
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (!command || !command.autocomplete) {
        console.error(`No autocomplete handler for ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Error in autocomplete for ${interaction.commandName}:`, error);
      }
      return;
    }

    // Handle chat input commands
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    if (
      ECONOMY_CHANNEL_COMMANDS.has(interaction.commandName) &&
      interaction.channelId !== config.economyChannelId
    ) {
      await interaction.reply({
        embeds: [
          EmbedService.error(
            'Wrong Channel',
            `This command can only be used in <#${config.economyChannelId}>.`,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 10062 || error.code === 40060)) {
        console.warn(`Interaction ${interaction.commandName} could not receive an error response: ${error.code}.`);
        return;
      }
      console.error(`Error executing ${interaction.commandName}:`, error);

      const errorResponse = {
        content: 'There was an error while executing this command!',
        ephemeral: true,
      };

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorResponse);
        } else {
          await interaction.reply(errorResponse);
        }
      } catch (responseError) {
        if (responseError instanceof Error && 'code' in responseError && (responseError.code === 10062 || responseError.code === 40060)) {
          console.warn(`Unable to send error response for ${interaction.commandName}: ${responseError.code}.`);
          return;
        }
        throw responseError;
      }
    }
  },
};
