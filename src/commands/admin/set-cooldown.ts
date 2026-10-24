import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner, config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

const COOLDOWN_LOG_CHANNEL_ID = '1504365033637806133';

const COMMANDS = [
  { name: 'Work', value: 'workCooldown', emoji: '💼' },
  { name: 'Fish', value: 'fishingCooldown', emoji: '🎣' },
  { name: 'Crime', value: 'crimeCooldown', emoji: '🔪' },
  { name: 'Beg', value: 'begCooldown', emoji: '🙏' },
  { name: 'Rob', value: 'robCooldown', emoji: '🔫' },
  { name: 'Bank Robbery', value: 'bankRobberyCooldown', emoji: '🏦' },
  { name: 'Scratchcard', value: 'scratchcardCooldown', emoji: '🎫' },
  { name: 'Games (All)', value: 'gamesCooldown', emoji: '🎮' },
  { name: 'Blackjack', value: 'blackjackCooldown', emoji: '🃏' },
  { name: 'Match Pairs', value: 'matchpairsCooldown', emoji: '🧩' },
  { name: '5 Dice', value: 'fivediceCooldown', emoji: '🎲' },
  { name: 'Lights Out', value: 'lightsoutCooldown', emoji: '💡' },
  { name: 'Mastermind', value: 'mastermindCooldown', emoji: '🧠' },
  { name: 'Hangman', value: 'hangmanCooldown', emoji: '☠️' },
  { name: 'High/Low', value: 'highlowCooldown', emoji: '📈' },
  { name: 'Rock Paper Scissors', value: 'rpsCooldown', emoji: '✂️' },
  { name: 'Tic Tac Toe', value: 'tictactoeCooldown', emoji: '⭕' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('set-cooldown')
    .setDescription('Configure an economy command cooldown')
    .addStringOption(option =>
      option
        .setName('command')
        .setDescription('Choose the command to configure')
        .setRequired(true)
        .addChoices(
          ...COMMANDS.map(cmd => ({
            name: `${cmd.emoji} ${cmd.name}`,
            value: cmd.value,
          }))
        )
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Cooldown duration in minutes (0 = no cooldown)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(10080)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Owner-only command.
    if (!isOwner(interaction.user.id)) {
      const embed = EmbedService.error(
        '🚫 Access Denied',
        'This command is restricted to the **bot owner**.'
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    try {
      const commandValue = interaction.options.getString('command', true);
      const minutes = interaction.options.getInteger('minutes', true);

      const selectedCommand = COMMANDS.find(
        cmd => cmd.value === commandValue
      );

      if (!selectedCommand) {
        const embed = EmbedService.error(
          '❌ Invalid Command',
          'That cooldown configuration does not exist.'
        );

        return interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }

      const milliseconds = minutes * 60 * 1000;
      const currentConfig = await prisma.serverConfig.findUnique({
        where: { guildId: interaction.guildId! },
        select: { [commandValue]: true },
      });
      const previousMilliseconds = Number(
        currentConfig?.[commandValue as keyof typeof currentConfig] ?? 0,
      );

      // Use upsert to create serverConfig if it doesn't exist
      await prisma.serverConfig.upsert({
        where: {
          guildId: interaction.guildId!,
        },
        update: {
          [commandValue]: milliseconds,
        },
        create: {
          guildId: interaction.guildId!,
          economyChannelId: '1537263365376708680',
          levelUpChannelId: '1540184622757974016',
          welcomeChannelId: '1542206242762530846',
          boosterChannelId: '1537241910157246494',
          leaveChannelId: '1542208002474516570',
          botOwnerId: '1341059228626063361',
          [commandValue]: milliseconds,
        },
      });

      // Clear existing cooldowns for this command to apply new setting immediately
      let commandName = selectedCommand.value.replace('Cooldown', '');
      // Special mapping for fishing -> fish
      if (commandName === 'fishing') {
        commandName = 'fish';
      }
      console.log(`[set-cooldown] Clearing cooldowns for command: ${commandName} (from ${selectedCommand.value})`);
      const deleteResult = await prisma.cooldown.deleteMany({
        where: {
          command: commandName,
        },
      });
      console.log(`[set-cooldown] Deleted ${deleteResult.count} cooldown records`);

      const formattedTime =
        minutes === 0
          ? 'No cooldown'
          : minutes >= 60
          ? `${Math.floor(minutes / 60)}h${
              minutes % 60 ? ` ${minutes % 60}m` : ''
            }`
          : `${minutes}m`;
      const previousMinutes = Math.floor(previousMilliseconds / 60_000);
      const previousFormattedTime =
        previousMilliseconds === 0
          ? 'No cooldown'
          : previousMinutes >= 60
          ? `${Math.floor(previousMinutes / 60)}h${previousMinutes % 60 ? ` ${previousMinutes % 60}m` : ''}`
          : `${previousMinutes}m`;

      const embed = EmbedService.success(
        '⚙️ Cooldown Updated',
        [
          `### ${selectedCommand.emoji} ${selectedCommand.name}`,
          '',
          `The cooldown has been successfully updated.`,
          '',
          `⏱️ **New Cooldown**`,
          `> **${formattedTime}**`,
          '',
          `🔄 **Cooldown Changed**`,
          `> **${previousFormattedTime}** → **${formattedTime}**`,
          '',
          `🛠️ **Changed By**`,
          `> ${interaction.user}`,
        ].join('\n')
      )
        .setFooter({
          text: 'Economy Configuration • Owner Panel',
        })
        .setTimestamp();

      try {
        const logChannel = await interaction.client.channels.fetch(COOLDOWN_LOG_CHANNEL_ID);
        if (logChannel?.isSendable()) {
          await logChannel.send({
            embeds: [
              EmbedService.info(
                '⚙️ Cooldown Changed',
                [
                  `**Command:** ${selectedCommand.emoji} ${selectedCommand.name} (\`${commandValue}\`)`,
                  `**Changed by:** ${interaction.user.tag} (${interaction.user.id})`,
                  '',
                  `**Cooldown:** **${previousFormattedTime}** → **${formattedTime}**`,
                  `**Set time:** ${minutes.toLocaleString()} minute${minutes === 1 ? '' : 's'}`,
                  `**Cleared active cooldowns:** ${deleteResult.count}`,
                ].join('\n'),
              ),
            ],
          });
        } else {
          console.warn(`Cooldown log channel ${COOLDOWN_LOG_CHANNEL_ID} is not sendable.`);
        }
      } catch (error) {
        console.error('Could not send set-cooldown audit log; cooldown update was successful:', error);
      }

      return interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error in set-cooldown command:', error);

      const embed = EmbedService.error(
        '💥 Update Failed',
        'I couldn’t update that cooldown. Make sure the server configuration exists and try again.'
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }
  },
};
