
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EconomyService } from '../../services/economy/index.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

const BEG_MESSAGES = [
  'A mysterious stranger tossed some credits your way.',
  'Someone felt bad for you and opened their wallet.',
  'A kind soul decided you looked trustworthy. Somehow.',
  'You stood on the street corner looking absolutely desperate.',
  'Someone walked past, tripped, and dropped some credits.',
  'A generous citizen decided to sponsor your questionable lifestyle.',
  'You delivered a truly convincing performance of desperation.',
  'A stranger looked at you, sighed, and handed you some credits.',
];

const BIG_REWARD_MESSAGES = [
  '💰 **JACKPOT!** Someone was feeling extremely generous.',
  '🤑 **WHAT A HANDOUT!** Your begging skills are unmatched.',
  '✨ **LUCKY DAY!** You seriously hit the jackpot.',
  '💸 **BIG DONATION!** Someone must really like you.',
];

export default {
  data: new SlashCommandBuilder()
    .setName('beg')
    .setDescription('Beg for a small amount of credits'),

  async execute(interaction: ChatInputCommandInteraction) {
    // Economy commands can only be used in the designated channel.
    if (interaction.channelId !== config.economyChannelId) {
      const embed = EmbedService.error(
        '🚫 Wrong Channel',
        `Economy commands can only be used in <#${config.economyChannelId}>.`
      );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    try {
      await interaction.deferReply();

      // Make sure the user has an account.
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

      // Check cooldown before doing anything else.
      const cooldown = await CooldownService.checkCooldown(
        interaction.user.id,
        'beg'
      );

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          '⏳ Take a Breather',
          `You've already begged recently.\n\n` +
            `Come back in **${cooldown}** and try your luck again!`
        )
          .setFooter({ text: `Begging • ${interaction.user.tag}` })
          .setTimestamp();

        return interaction.editReply({
          embeds: [embed],
        });
      }

      // Track the attempt.
      const account = await EconomyService.getBalance(interaction.user.id);

      await prisma.economyAccount.update({
        where: {
          userId: account.userId,
        },
        data: {
          begAttempts: {
            increment: 1,
          },
        },
      });

      // Set cooldown before awarding the reward.
      await CooldownService.setCooldown(
        interaction.user.id,
        'beg'
      );

      // Random reward: 1–50 credits.
      const reward = Math.floor(Math.random() * 50) + 1;

      await EconomyService.addCredits(
        interaction.user.id,
        reward,
        'Begging',
        'BEG'
      );

      // Pick a random message to make each beg feel different.
      const message =
        BEG_MESSAGES[Math.floor(Math.random() * BEG_MESSAGES.length)];

      // Rare Old Shoe collectible — 0.1% chance.
      const foundOldShoe = Math.random() < 0.001;

      if (foundOldShoe) {
        const isNew = await InventoryService.addCollectible(
          interaction.user.id,
          'oldShoe'
        );

        const collectibleText = isNew
          ? '🎉 **RARE FIND!** You discovered the legendary **Old Shoe 👟**!'
          : '👟 You found another **Old Shoe**... You already own this collectible!';

        const embed = EmbedService.success(
          '🤲 Begging Pays Off!',
          `${message}\n\n` +
            `💰 **+${reward.toLocaleString()} credits**\n\n` +
            `${collectibleText}`
        )
          .setFooter({
            text: `Begging • ${interaction.user.tag}`,
          })
          .setTimestamp();

        return interaction.editReply({
          embeds: [embed],
        });
      }

      // Make bigger rewards feel more rewarding.
      const rewardMessage =
        reward >= 40
          ? BIG_REWARD_MESSAGES[
              Math.floor(Math.random() * BIG_REWARD_MESSAGES.length)
            ]
          : null;

      const embed = EmbedService.success(
        reward >= 40 ? '🤑 Begging Jackpot!' : '🤲 Begging Successful',
        `${message}\n\n` +
          `💰 **+${reward.toLocaleString()} credits**` +
          (rewardMessage ? `\n\n${rewardMessage}` : '')
      )
        .setFooter({
          text: `Begging • ${interaction.user.tag}`,
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error in beg command:', error);

      const embed = EmbedService.error(
        '💥 Something Went Wrong',
        'Your begging attempt failed. No credits were lost — try again later.'
      );

      await interaction.editReply({
        embeds: [embed],
      });
    }
  },
};
