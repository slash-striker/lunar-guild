import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { isOwner } from '../../config/index.ts';
import { InventoryService } from '../../services/inventory/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('set-inventory')
    .setDescription('Set a user\'s inventory item amount (Owner only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to modify inventory for')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('item')
        .setDescription('The item key (e.g., coffee, luckyDice)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The new amount')
        .setRequired(true)
        .setMinValue(0)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      const embed = EmbedService.error('Permission Denied', 'This command is restricted to the bot owner.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user', true);
      const itemKey = interaction.options.getString('item', true);
      const amount = interaction.options.getInteger('amount', true);

      // Get user ID
      const user = await prisma.user.upsert({
        where: { discordId: targetUser.id },
        update: {},
        create: {
          discordId: targetUser.id,
          guildId: interaction.guildId!,
        },
      });

      // Set inventory amount
      if (amount === 0) {
        // Remove item if amount is 0
        await prisma.inventoryItem.deleteMany({
          where: {
            userId: user.id,
            itemId: itemKey,
          },
        });
      } else {
        await prisma.inventoryItem.upsert({
          where: {
            userId_itemId: {
              userId: user.id,
              itemId: itemKey,
            },
          },
          update: {
            quantity: amount,
          },
          create: {
            userId: user.id,
            itemId: itemKey,
            quantity: amount,
          },
        });
      }

      const embed = EmbedService.success(
        '✅ Inventory Updated',
        `Set **${targetUser.tag}**'s **${itemKey}** amount to **${amount}**.`
      )
        .setFooter({ text: `Admin: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in set-inventory command:', error);
      const embed = EmbedService.error('Error', 'Failed to update inventory.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
