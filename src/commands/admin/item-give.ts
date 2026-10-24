import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner, config } from '../../config/index.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import { EconomyService } from '../../services/economy/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('item-give')
    .setDescription('Give an item to another user (Admins: give any item, Users: give items you own)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to give the item to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('item')
        .setDescription('The item to give')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('The quantity to give (default: 1)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user', true);
      const itemName = interaction.options.getString('item', true);
      const quantity = interaction.options.getInteger('quantity') || 1;
      const isAdmin = isOwner(interaction.user.id);

      // Prevent giving to yourself
      if (targetUser.id === interaction.user.id) {
        const embed = EmbedService.error('Invalid Target', 'You cannot give items to yourself.');
        return interaction.editReply({ embeds: [embed] });
      }

      // Find item (fuzzy matching)
      const itemKey = Object.keys(config.shopItems).find(key =>
        config.shopItems[key as keyof typeof config.shopItems].name.toLowerCase().includes(itemName.toLowerCase())
      );

      if (!itemKey) {
        const embed = EmbedService.error('Item Not Found', 'That item does not exist in the shop.');
        return interaction.editReply({ embeds: [embed] });
      }

      const item = config.shopItems[itemKey as keyof typeof config.shopItems];

      // Exclude lucky mystery boxes for everyone
      if (itemKey === 'luckyMysteryBox') {
        const embed = EmbedService.error('Restricted Item', 'Lucky Mystery Boxes cannot be given via this command.');
        return interaction.editReply({ embeds: [embed] });
      }

      // Get users
      const senderUser = await prisma.user.upsert({
        where: { discordId: interaction.user.id },
        update: {},
        create: {
          discordId: interaction.user.id,
          guildId: interaction.guildId!,
        },
      });

      const targetUserRecord = await prisma.user.upsert({
        where: { discordId: targetUser.id },
        update: {},
        create: {
          discordId: targetUser.id,
          guildId: interaction.guildId!,
        },
      });

      if (isAdmin) {
        // Admin mode: give any item (excluding lucky mystery boxes already checked)
        await handleAdminGive(interaction, targetUser, targetUserRecord, itemKey, item, quantity);
      } else {
        // User mode: give item only if they own it
        await handleUserGive(interaction, interaction.user, senderUser, targetUser, targetUserRecord, itemKey, item, quantity);
      }
    } catch (error) {
      console.error('Error in item-give command:', error);
      const embed = EmbedService.error('Error', 'Failed to give item.');
      await interaction.editReply({ embeds: [embed] });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused();
    const isAdmin = isOwner(interaction.user.id);
    const items = Object.entries(config.shopItems);

    let filtered;

    if (isAdmin) {
      // Admins see all items except lucky mystery boxes
      filtered = items
        .filter(([key]) => key !== 'luckyMysteryBox')
        .filter(([key, item]) =>
          item.name.toLowerCase().includes(focusedValue.toLowerCase())
        );
    } else {
      // Regular users only see items they own
      const userInventory = await InventoryService.getInventory(interaction.user.id);
      const ownedItemKeys = userInventory.map((inv: any) => inv.itemId);
      
      filtered = items
        .filter(([key]) => ownedItemKeys.includes(key))
        .filter(([key, item]) =>
          item.name.toLowerCase().includes(focusedValue.toLowerCase())
        );
    }

    await interaction.respond(
      filtered.map(([key, item]) => ({
        name: item.name,
        value: item.name,
      }))
    );
  },
};

async function handleAdminGive(
  interaction: ChatInputCommandInteraction,
  targetUser: any,
  targetUserRecord: any,
  itemKey: string,
  item: any,
  quantity: number
) {
  // Mystery boxes are opened immediately and are never stored.
  if (itemKey === 'mysteryBox') {
    const reward = await openMysteryBox(targetUser.id, false);
    const embed = EmbedService.success(
      '🎁 Item Given & Mystery Box Opened!',
      `Gave **${targetUser.tag}** a ${item.name} which opened to reveal:\n**${reward}**`
    )
      .setFooter({ text: `Admin: ${interaction.user.tag}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Check inventory limit for regular items.
  if (item.maxLimit) {
    const currentInventory = await InventoryService.getItemQuantity(targetUser.id, itemKey);
    if (currentInventory + quantity > item.maxLimit) {
      const embed = EmbedService.error(
        'Inventory Limit Reached',
        `User can only have a maximum of ${item.maxLimit} ${item.name}. They currently have ${currentInventory}.`
      );
      return interaction.editReply({ embeds: [embed] });
    }
  }

  // Add items to target
  await InventoryService.addItem(targetUser.id, itemKey, quantity);

  const embed = EmbedService.success(
    '✅ Item Given',
    `Gave **${targetUser.tag}** **${quantity}x ${item.name}**!`
  )
    .setFooter({ text: `Admin: ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleUserGive(
  interaction: ChatInputCommandInteraction,
  senderUser: any,
  senderUserRecord: any,
  targetUser: any,
  targetUserRecord: any,
  itemKey: string,
  item: any,
  quantity: number
) {
  // Check if sender has enough of the item
  const senderQuantity = await InventoryService.getItemQuantity(interaction.user.id, itemKey);
  if (senderQuantity < quantity) {
    const embed = EmbedService.error(
      'Insufficient Items',
      `You only have ${senderQuantity}x ${item.name}. You need ${quantity}x to give.`
    );
    return interaction.editReply({ embeds: [embed] });
  }

  // Check if item is tradeable
  if (!item.isTradeable) {
    const embed = EmbedService.error(
      'Item Not Tradeable',
      `This item cannot be given to other users.`
    );
    return interaction.editReply({ embeds: [embed] });
  }

  // Check inventory limit for target
  if (item.maxLimit) {
    const currentInventory = await InventoryService.getItemQuantity(targetUser.id, itemKey);
    if (currentInventory + quantity > item.maxLimit) {
      const embed = EmbedService.error(
        'Inventory Limit Reached',
        `User can only have a maximum of ${item.maxLimit} ${item.name}. They currently have ${currentInventory}.`
      );
      return interaction.editReply({ embeds: [embed] });
    }
  }

  // Remove from sender
  await InventoryService.removeItem(interaction.user.id, itemKey, quantity);

  // Add to target
  await InventoryService.addItem(targetUser.id, itemKey, quantity);

  const embed = EmbedService.success(
    '✅ Item Given',
    `You gave **${targetUser.tag}** **${quantity}x ${item.name}**!`
  )
    .setFooter({ text: `From: ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function openMysteryBox(userId: string, isLucky: boolean) {
  const creditRewards = isLucky ? [500, 1000, 2000] : [100, 500, 1000];
  const amount = creditRewards[Math.floor(Math.random() * creditRewards.length)];
  await EconomyService.addCredits(userId, amount, 'Mystery box reward', 'MYSTERY_BOX');

  const itemRewards = isLucky
    ? [['coffee', 'Coffee'], ['energyDrink', 'Energy Drink'], ['luckyDice', 'Lucky Dice']]
    : [['coffee', 'Coffee'], ['energyDrink', 'Energy Drink']];
  const rewards = [`${amount.toLocaleString()} credits`];
  if (Math.random() < (isLucky ? 0.6 : 0.35)) {
    const [itemId, itemName] = itemRewards[Math.floor(Math.random() * itemRewards.length)];
    await InventoryService.addItem(userId, itemId, 1);
    rewards.push(`1x ${itemName}`);
  }
  return rewards.join(' and ');
}
