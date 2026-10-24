import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { EmbedService } from '../embeds/index.ts';
import { isOwner } from '../config/index.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('lunar-info')
    .setDescription('Post detailed Lunar Guild Bot information (administrator only)'),
  async execute(interaction: ChatInputCommandInteraction) {
    const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    if (!isOwner(interaction.user.id) && !isAdministrator) {
      await interaction.reply({
        embeds: [EmbedService.error('Access Denied', 'This command requires the Discord Administrator permission.')],
        ephemeral: true,
      });
      return;
    }
    const embed = EmbedService.info(
      '🌙 Lunar Guild Bot',
      '**Welcome to Lunar Guild Bot** — a community economy, progression, collection, and games bot.\n\n' +
      '**Getting started**\n' +
      'Use `/balance` to view credits, `/daily` for a daily reward, and `/work` to earn through your current job. `/job-list` shows career milestones and `/job-apply` lets you apply for unlocked jobs.\n\n' +
      '**Economy and progression**\n' +
      'Use `/bank` to protect and manage savings, `/shop` to buy items, `/inventory` to view items, and `/cooldowns` to see localized Discord countdowns. Fishing includes `/fish`, `/fish-collection`, `/sell-fish`, and `/fishing-shop`. Lottery, crime, robbery, and bank robbery are higher-risk economy features.\n\n' +
      '**Items**\n' +
      'Coffee can affect work outcomes, Energy Drinks add work credits, Lucky Dice improve eligible odds, Watchdogs protect against robbery, Mobile Phones send bank robbery alerts, and mystery boxes open immediately with rewards.\n\n' +
      '**Games**\n' +
      'Play `/5dice`, `/blackjack`, `/hangman`, `/highlow`, `/lightsout`, `/mastermind`, `/matchpairs`, `/rps`, `/scratchcard`, and `/tictac`. Games may use buttons or selectors, have cooldowns, and save statistics where supported. Use `/help` for detailed instructions for every game and its options.\n\n' +
      '**Rules and safety**\n' +
      'Economy commands and games are restricted to the designated economy channel. Game interactions are owner-checked, concurrent actions are locked, and rewards are calculated server-side. Never share account credentials or claim that game outcomes can be manipulated.\n\n' +
      '**Useful references**\n' +
      '`/help` — interactive player guide\n`/cooldowns` — command readiness dashboard\n`/level` and `/leaderboard` — progression rankings\n\n' +
      'Have fun, play fairly, and help new members use `/help` when they join!',
    ).setFooter({ text: 'Lunar Guild Bot • Administrator-posted community information' });
    await interaction.reply({ embeds: [embed] });
  },
};
