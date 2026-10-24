import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const randomFrom = <T>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

/**
 * Daily reward multiplier chances:
 *
 * 1x = 85%
 * 2x = 10%
 * 3x = 4%
 * 5x = 1%
 */
const rollMultiplier = (): number => {
  const roll = Math.random();

  if (roll < 0.01) return 5;
  if (roll < 0.05) return 3;
  if (roll < 0.15) return 2;

  return 1;
};

const progressBar = (percentage: number, length = 12): string => {
  const filled = Math.round((percentage / 100) * length);

  return (
    '▰'.repeat(filled) +
    '▱'.repeat(length - filled)
  );
};

const getMultiplierTitle = (multiplier: number): string => {
  switch (multiplier) {
    case 5:
      return '💎 LEGENDARY BONUS';
    case 3:
      return '🔥 EPIC BONUS';
    case 2:
      return '✨ LUCKY BONUS';
    default:
      return '🎁 DAILY REWARD';
  }
};

const getRewardFlavor = (multiplier: number): string => {
  if (multiplier === 5) {
    return randomFrom([
      '💎 The vault opened its **legendary tier**!',
      '👑 You hit the **jackpot**!',
      '🌟 The stars aligned perfectly!',
      '💰 The vault just paid out BIG.',
    ]);
  }

  if (multiplier === 3) {
    return randomFrom([
      '🔥 The vault decided to go BIG today!',
      '⚡ Your luck is absolutely insane!',
      '🎰 Triple credits! The vault is feeling generous.',
    ]);
  }

  if (multiplier === 2) {
    return randomFrom([
      '✨ The vault gave you a little something extra!',
      '🍀 Lucky you! Your reward doubled.',
      '💫 The daily vault blessed you today.',
    ]);
  }

  return randomFrom([
    '🎁 Your daily reward has arrived.',
    '✨ Another day, another reward.',
    '💰 The vault has something for you.',
    '🪙 Your daily credits are ready.',
  ]);
};

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily bonus'),

  async execute(interaction: ChatInputCommandInteraction) {
    // ============================================================
    // CHANNEL CHECK
    // ============================================================

    if (interaction.channelId !== config.economyChannelId) {
      const embed = EmbedService.error(
        'Wrong Channel',
        `Economy commands can only be used in <#${config.economyChannelId}>`
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    try {
      // ============================================================
      // DEFER
      // ============================================================

      await interaction.deferReply();

      // ============================================================
      // ENSURE USER EXISTS
      // ============================================================

      await prisma.user.upsert({
        where: {
          discordId: interaction.user.id,
        },
        update: {},
        create: {
          discordId: interaction.user.id,
          guildId: interaction.guildId!,
        },
      });

      // ============================================================
      // CHECK COOLDOWN
      // ============================================================

      const cooldown = await CooldownService.checkCooldown(
        interaction.user.id,
        'daily',
        COOLDOWN_MS
      );

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          '⏳ Daily Reward Locked',
          [
            'You have already claimed your daily reward.',
            '',
            '✦ ─────────────── ✦',
            '',
            `⏰ **Next reward in:** ${cooldown}`,
            '',
            '✦ Come back later and try your luck again!',
          ].join('\n')
        );

        return interaction.editReply({
          embeds: [embed],
        });
      }

      // ============================================================
      // PROCESSING — STAGE 1
      // ============================================================

      const searchingEmbed = EmbedService.success(
        '✦ DAILY VAULT ✦',
        [
          '✦ ─────────────── ✦',
          '',
          '        🔮',
          '   **DAILY REWARD**',
          '',
          '✧ Searching the vault...',
          '',
          `\`${progressBar(25)}\` **25%**`,
          '',
          '✦ ─────────────── ✦',
        ].join('\n')
      ).setFooter({
        text: `Requested by ${interaction.user.tag}`,
      });

      await interaction.editReply({
        embeds: [searchingEmbed],
      });

      await sleep(700);

      // ============================================================
      // PROCESSING — STAGE 2
      // ============================================================

      const unlockingEmbed = EmbedService.success(
        '✦ DAILY VAULT ✦',
        [
          '✧ ─────────────── ✧',
          '',
          '        🔓',
          '   **VAULT UNLOCKING**',
          '',
          '✦ Something is inside...',
          '',
          `\`${progressBar(55)}\` **55%**`,
          '',
          '✧ ─────────────── ✧',
        ].join('\n')
      ).setFooter({
        text: `Requested by ${interaction.user.tag}`,
      });

      await interaction.editReply({
        embeds: [unlockingEmbed],
      });

      await sleep(750);

      // ============================================================
      // ROLL MULTIPLIER
      // ============================================================

      const multiplier = rollMultiplier();

      const reward = Math.floor(
        config.dailyAmount * multiplier
      );

      // ============================================================
      // PROCESSING — STAGE 3
      // ============================================================

      const rollingEmbed = EmbedService.success(
        '✦ DAILY VAULT ✦',
        [
          '✦ ─────────────── ✦',
          '',
          '        🎰',
          '    **ROLLING...**',
          '',
          '✧ Determining your bonus...',
          '',
          `\`${progressBar(85)}\` **85%**`,
          '',
          '✦  ✧  ✦  ✧  ✦',
          '',
          '✦ ─────────────── ✦',
        ].join('\n')
      ).setFooter({
        text: `Requested by ${interaction.user.tag}`,
      });

      await interaction.editReply({
        embeds: [rollingEmbed],
      });

      await sleep(1000);

      // ============================================================
      // GIVE REWARD
      // ============================================================

      await EconomyService.addCredits(
        interaction.user.id,
        reward,
        'Daily bonus',
        'DAILY'
      );

      // Only start the cooldown after the reward was successfully given.
      await CooldownService.setCooldown(
        interaction.user.id,
        'daily',
        COOLDOWN_MS
      );

      // ============================================================
      // FINAL REVEAL
      // ============================================================

      const bonusSection =
        multiplier > 1
          ? [
              '',
              '✧ ─────────────── ✧',
              '',
              `      ✨ **${multiplier}× BONUS** ✨`,
              '',
              '✧ ─────────────── ✧',
            ].join('\n')
          : '';

      const finalEmbed = EmbedService.success(
        `✦ ${getMultiplierTitle(multiplier)} ✦`,
        [
          '✦ ─────────────── ✦',
          '',
          '          🎁',
          '',
          '    **DAILY REWARD**',
          '',
          '✧ ─────────────── ✧',
          '',
          `     💰 **${reward.toLocaleString()}**`,
          '         **CREDITS**',
          '',
          '✧ ─────────────── ✧',
          '',
          getRewardFlavor(multiplier),
          bonusSection,
          '',
          '✦  ✧  ✦  ✧  ✦  ✧  ✦',
          '',
          '⏰ **Next reward:** 24 hours',
          '🎁 Come back tomorrow!',
        ].join('\n')
      )
        .setFooter({
          text: `User: ${interaction.user.tag}`,
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [finalEmbed],
      });
    } catch (error) {
      console.error('Error in daily command:', error);

      const embed = EmbedService.error(
        '❌ Daily Reward Failed',
        [
          'Something went wrong while processing your reward.',
          '',
          'Please try again in a moment.',
        ].join('\n')
      );

      try {
        await interaction.editReply({
          embeds: [embed],
        });
      } catch (replyError) {
        console.error(
          'Failed to send daily error response:',
          replyError
        );
      }
    }
  },
};
