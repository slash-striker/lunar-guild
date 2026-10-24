import { SlashCommandBuilder, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { FishingService } from '../../services/economy/fishing.ts';
import { EmbedService } from '../../embeds/index.ts';
import { RARITY_COLORS, RARITY_EMOJIS } from '../../config/fish.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('fish-collection')
    .setDescription('View your caught fish collection'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const stats = await FishingService.getFishingStats(interaction.user.id, interaction.guildId!);
      const caughtFish = await FishingService.getCaughtFish(interaction.user.id, interaction.guildId!, 10);

      if (caughtFish.length === 0) {
        const embed = EmbedService.info(
          '🎣 Fish Collection',
          [
            `### Your Stats`,
            '',
            `🎣 Total Fish Caught: ${stats.fishingCount}`,
            `📦 Fish in Inventory: 0`,
            `💰 Total Inventory Value: 0 credits`,
            '',
            `Use \`/fish\` to start fishing!`,
          ].join('\n')
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // Calculate total value
      const totalValue = caughtFish.reduce((sum: number, fish: any) => sum + fish.value, 0);

      // Build fish list
      const fishList = caughtFish.map((fish: any, index: number) => {
        const rarityEmoji = RARITY_EMOJIS[fish.fish.rarity as keyof typeof RARITY_EMOJIS];
        return `${index + 1}. ${fish.fish.emoji} **${fish.fish.name}** ${rarityEmoji}\n   ⚖️ ${fish.weight.toFixed(2)}kg • 💰 ${fish.value.toLocaleString()} credits`;
      }).join('\n\n');

      const embed = EmbedService.info(
        '🎣 Fish Collection',
        [
          `### Your Stats`,
          '',
          `🎣 Total Fish Caught: ${stats.fishingCount}`,
          `📦 Fish in Inventory: ${stats.totalCaught}`,
          `💰 Total Inventory Value: ${stats.totalValue.toLocaleString()} credits`,
          '',
          `### Recent Catches (Showing ${caughtFish.length})`,
          '',
          fishList,
        ].join('\n')
      )
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      // Add sell button if user has fish
      const sellButton = new ButtonBuilder()
        .setCustomId('sell_all_fish')
        .setLabel('Sell All Fish')
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(sellButton);

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // Create collector for button
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: 'This is not your menu!', ephemeral: true });
          return;
        }

        if (i.customId === 'sell_all_fish') {
          const result = await FishingService.sellAllFish(interaction.user.id, interaction.guildId!);

          const embed = EmbedService.success(
            '💰 Fish Sold',
            [
              `### Sold ${result.count} fish`,
              '',
              `You received **${result.totalValue.toLocaleString()} credits**!`,
            ].join('\n')
          )
            .setFooter({ text: `User: ${interaction.user.tag}` })
            .setTimestamp();

          await i.update({ embeds: [embed], components: [] });
        }
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          await message.edit({ components: [] });
        }
      });
    } catch (error) {
      console.error('Error in fish-collection command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fetching your fish collection.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
