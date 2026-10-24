import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { FishingTycoonService } from '../../services/economy/fishing-tycoon.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import { FISHING_EQUIPMENT, type EquipmentType } from '../../config/fishing-equipment.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('fishing-shop')
    .setDescription('View and purchase fishing equipment upgrades')
    .addSubcommand(subcommand =>
      subcommand.setName('view').setDescription('View your current fishing equipment')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('buy')
        .setDescription('Purchase a fishing equipment upgrade')
        .addStringOption(option =>
          option.setName('equipment').setDescription('The equipment to upgrade').setRequired(true).setAutocomplete(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Check if in economy channel
    if (interaction.channelId !== config.economyChannelId) {
      const embed = EmbedService.error(
        'Wrong Channel',
        `Economy commands can only be used in <#${config.economyChannelId}>`
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      await interaction.deferReply();

      // Ensure user exists
      await prisma.user.upsert({
        where: { discordId: interaction.user.id },
        update: {},
        create: {
          discordId: interaction.user.id,
          guildId: interaction.guildId!,
        },
      });

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'view':
          await handleView(interaction);
          break;
        case 'buy':
          await handleBuy(interaction);
          break;
      }
    } catch (error) {
      console.error('Error in fishing-shop command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your request.');
      await interaction.editReply({ embeds: [embed] });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused();
    const upgrades = await FishingTycoonService.getAvailableUpgrades(interaction.user.id);

    const filtered = upgrades.filter(
      upgrade =>
        upgrade.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
        upgrade.type.toLowerCase().includes(focusedValue.toLowerCase())
    );

    await interaction.respond(
      filtered.slice(0, 25).map(upgrade => ({
        name: `${upgrade.emoji} ${upgrade.name} (${upgrade.type}) - ${upgrade.price.toLocaleString()} credits`,
        value: `${upgrade.type}:${upgrade.key}`,
      }))
    );
  },
};

async function handleView(interaction: ChatInputCommandInteraction) {
  const equipment = await FishingTycoonService.getEquipment(interaction.user.id);
  const bonuses = await FishingTycoonService.getEquipmentBonuses(interaction.user.id);

  const rod = FISHING_EQUIPMENT.rods[equipment.rod as keyof typeof FISHING_EQUIPMENT.rods];
  const hook = FISHING_EQUIPMENT.hooks[equipment.hook as keyof typeof FISHING_EQUIPMENT.hooks];
  const bait = FISHING_EQUIPMENT.bait[equipment.bait as keyof typeof FISHING_EQUIPMENT.bait];
  const boat = FISHING_EQUIPMENT.boats[equipment.boat as keyof typeof FISHING_EQUIPMENT.boats];
  const water = FISHING_EQUIPMENT.water[equipment.water as keyof typeof FISHING_EQUIPMENT.water];

  const description =
    `🎣 **Rod**: ${rod.emoji} ${rod.name} (Tier ${rod.tier})\n` +
    `🪝 **Hook**: ${hook.emoji} ${hook.name} (Tier ${hook.tier})\n` +
    `🪱 **Bait**: ${bait.emoji} ${bait.name} (Tier ${bait.tier})\n` +
    `🚣 **Boat**: ${boat.emoji} ${boat.name} (Tier ${boat.tier})\n` +
    `🏖 **Water**: ${water.emoji} ${water.name} (Tier ${water.tier})\n\n` +
    `**Total Bonuses**:\n` +
    `Catch Rate: +${(bonuses.catchRateBonus * 100).toFixed(0)}%\n` +
    `Rarity: +${(bonuses.rarityBonus * 100).toFixed(0)}%\n` +
    `Value: +${(bonuses.valueBonus * 100).toFixed(0)}%\n` +
    `Variety: +${(bonuses.varietyBonus * 100).toFixed(0)}%\n` +
    `Capacity: +${(bonuses.capacityBonus * 100).toFixed(0)}%\n` +
    `Special Fish: +${(bonuses.specialFishBonus * 100).toFixed(0)}%`;

  const embed = EmbedService.economy('🎣 Fishing Equipment', description)
    .setFooter({ text: `User: ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleBuy(interaction: ChatInputCommandInteraction) {
  const equipmentValue = interaction.options.getString('equipment', true);
  const [type, key] = equipmentValue.split(':');

  if (!type || !key) {
    const embed = EmbedService.error('Invalid Selection', 'Please select a valid equipment upgrade.');
    return interaction.editReply({ embeds: [embed] });
  }

  try {
    const upgrade = await FishingTycoonService.upgradeEquipment(
      interaction.user.id,
      type as EquipmentType,
      key
    );

    const embed = EmbedService.success(
      '✅ Equipment Upgraded!',
      `You purchased **${upgrade.emoji} ${upgrade.name}** for ${upgrade.price.toLocaleString()} credits!\n\n${upgrade.description}`
    )
      .setFooter({ text: `User: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Purchase Failed', error.message || 'Failed to purchase equipment.');
    await interaction.editReply({ embeds: [embed] });
  }
}
