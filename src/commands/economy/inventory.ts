import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { InventoryService } from '../../services/inventory/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { config } from '../../config/index.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your inventory')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('View another user\'s inventory')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user') || interaction.user;

      // Ensure user exists
      await prisma.user.upsert({
        where: { discordId: targetUser.id },
        update: {},
        create: {
          discordId: targetUser.id,
          guildId: interaction.guildId!,
        },
      });

      const inventory = await InventoryService.getInventory(targetUser.id);

      if (inventory.length === 0) {
        const embed = EmbedService.info('Inventory', `${targetUser.toString()} has no items.`);
        return interaction.editReply({ embeds: [embed] });
      }

      let description = '**Items:**\n';
      for (const item of inventory) {
        const itemData = config.shopItems[item.itemId as keyof typeof config.shopItems];
        if (itemData) {
          const emoji = (itemData as any).emoji || '📦';
          description += `${emoji} **${itemData.name}** x${item.quantity}\n`;
        }
      }

      const embed = EmbedService.info(
        `🎒 ${targetUser.username}'s Inventory`,
        description
      )
        .setFooter({ text: `User: ${targetUser.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in inventory command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching your inventory.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
