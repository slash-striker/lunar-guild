import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { InventoryService } from '../../services/inventory/index.ts';
import { EconomyService } from '../../services/economy/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View and purchase shop items')
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View all available shop items')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('buy')
        .setDescription('Purchase an item from the shop')
        .addStringOption(option =>
          option.setName('item')
            .setDescription('The item to purchase')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option.setName('quantity')
            .setDescription('The quantity to purchase (default: 1)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
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
      console.error('Error in shop command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while processing your request.');
      await interaction.editReply({ embeds: [embed] });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused();
    const items = Object.entries(config.shopItems);

    const filtered = items.filter(([key, item]) =>
      item.name.toLowerCase().includes(focusedValue.toLowerCase())
    );

    await interaction.respond(
      filtered.map(([key, item]) => ({
        name: item.name,
        value: item.name,
      }))
    );
  },
};

async function handleView(interaction: ChatInputCommandInteraction) {
  const items = Object.entries(config.shopItems).map(([key, item]) => {
    const emoji = (item as any).emoji || '📦';
    const limitText = item.maxLimit ? ` (Max: ${item.maxLimit})` : '';
    return `${emoji} **${item.name}** - ${item.price.toLocaleString()} credits${limitText}\n${item.description}`;
  }).join('\n\n');

  const embed = EmbedService.economy(
    '🛒 Shop',
    items
  )
    .setFooter({ text: 'Use /shop buy to purchase an item' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleBuy(interaction: ChatInputCommandInteraction) {
  const itemName = interaction.options.getString('item', true);
  const quantity = interaction.options.getInteger('quantity') || 1;

  // Find item (fuzzy matching)
  const itemKey = Object.keys(config.shopItems).find(key =>
    config.shopItems[key as keyof typeof config.shopItems].name.toLowerCase().includes(itemName.toLowerCase())
  );

  if (!itemKey) {
    const embed = EmbedService.error('Item Not Found', 'That item does not exist in the shop.');
    return interaction.editReply({ embeds: [embed] });
  }

  const item = config.shopItems[itemKey as keyof typeof config.shopItems];

  // Mystery boxes cannot be purchased in quantity
  if ((itemKey === 'mysteryBox' || itemKey === 'luckyMysteryBox') && quantity > 1) {
    const embed = EmbedService.error('Invalid Quantity', 'Mystery boxes can only be purchased one at a time.');
    return interaction.editReply({ embeds: [embed] });
  }

  try {
    const balance = await EconomyService.getBalance(interaction.user.id);
    const totalPrice = item.price * quantity;

    // Check balance
    if (balance.wallet < totalPrice) {
      const embed = EmbedService.error(
        'Insufficient Funds',
        `You need ${totalPrice.toLocaleString()} credits to buy ${quantity}x ${item.name}. You have ${balance.wallet.toLocaleString()} credits.`
      );
      return interaction.editReply({ embeds: [embed] });
    }

    // Check inventory limit
    if (item.maxLimit) {
      const currentInventory = await InventoryService.getItemQuantity(interaction.user.id, itemKey);
      if (currentInventory + quantity > item.maxLimit) {
        const embed = EmbedService.error(
          'Inventory Limit Reached',
          `You can only have a maximum of ${item.maxLimit} ${item.name}. You currently have ${currentInventory}.`
        );
        return interaction.editReply({ embeds: [embed] });
      }
    }

    // Remove credits
    await EconomyService.removeCredits(interaction.user.id, totalPrice, `Purchased ${quantity}x ${item.name}`, 'SHOP');

    // Handle mystery boxes (open immediately)
    if (itemKey === 'mysteryBox' || itemKey === 'luckyMysteryBox') {
      const reward = await openMysteryBox(interaction.user.id, itemKey === 'luckyMysteryBox');

      const embed = EmbedService.success(
        '🎁 Mystery Box Opened!',
        `You opened a ${item.name} and received:\n**${reward}**`
      )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Add regular items to inventory.
    await InventoryService.addItem(interaction.user.id, itemKey, quantity);

    const embed = EmbedService.success(
      '✅ Purchase Successful',
      `You purchased **${quantity}x ${item.name}** for ${totalPrice.toLocaleString()} credits!`
    )
      .setFooter({ text: `User: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error: any) {
    const embed = EmbedService.error('Error', error.message || 'Failed to purchase item.');
    await interaction.editReply({ embeds: [embed] });
  }
}

async function openMysteryBox(userId: string, isLucky: boolean) {
  const creditRewards = isLucky ? [500, 1000, 2000] : [100, 500, 1000];
  const amount = creditRewards[Math.floor(Math.random() * creditRewards.length)];
  await EconomyService.addCredits(userId, amount, 'Mystery box reward', 'MYSTERY_BOX');

  const itemRewards = isLucky
    ? [['coffee', 'Coffee'], ['energyDrink', 'Energy Drink'], ['luckyDice', 'Lucky Dice']]
    : [['coffee', 'Coffee'], ['energyDrink', 'Energy Drink']];
  const itemChance = isLucky ? 0.6 : 0.35;
  const rewards = [`${amount.toLocaleString()} credits`];
  if (Math.random() < itemChance) {
    const [itemId, itemName] = itemRewards[Math.floor(Math.random() * itemRewards.length)];
    await InventoryService.addItem(userId, itemId, 1);
    rewards.push(`1x ${itemName}`);
  }
  return rewards.join(' and ');
}
