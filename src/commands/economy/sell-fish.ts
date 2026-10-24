import { SlashCommandBuilder, ChatInputCommandInteraction, StringSelectMenuBuilder, ActionRowBuilder, ComponentType } from 'discord.js';
import { FishingService } from '../../services/economy/fishing.ts';
import { EmbedService } from '../../embeds/index.ts';
import { RARITY_COLORS, RARITY_EMOJIS } from '../../config/fish.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('sell-fish')
    .setDescription('Sell your caught fish for credits')
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Choose what to sell')
        .setRequired(true)
        .addChoices(
          { name: 'Sell All Fish', value: 'all' },
          { name: 'Sell Specific Fish', value: 'specific' },
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const action = interaction.options.getString('action', true);

      if (action === 'all') {
        await interaction.deferReply();

        const result = await FishingService.sellAllFish(interaction.user.id, interaction.guildId!);

        if (result.count === 0) {
          const embed = EmbedService.warning(
            'No Fish to Sell',
            'You don\'t have any fish in your inventory.'
          );
          return interaction.editReply({ embeds: [embed] });
        }

        const embed = EmbedService.success(
          '💰 Fish Sold',
          [
            `### Sold ${result.count} fish`,
            '',
            '**Fish sold:**',
            (result.fish ?? []).map((fish) => `${fish.emoji} ${fish.name} — ${fish.value.toLocaleString()} credits`).join('\n'),
            '',
            `You received **${result.totalValue.toLocaleString()} credits**!`,
          ].join('\n')
        )
          .setFooter({ text: `User: ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        // Show selection menu for specific fish
        const caughtFish = await FishingService.getCaughtFish(interaction.user.id, interaction.guildId!, 25);

        if (caughtFish.length === 0) {
          const embed = EmbedService.warning(
            'No Fish to Sell',
            'You don\'t have any fish in your inventory.'
          );
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const options = caughtFish.map((fish: typeof caughtFish[number]) => ({
          label: `${fish.fish.emoji} ${fish.fish.name} (${fish.weight.toFixed(2)}kg) - ${fish.value.toLocaleString()} credits`,
          value: fish.id,
          description: `${RARITY_EMOJIS[fish.fish.rarity as keyof typeof RARITY_EMOJIS]} ${fish.fish.rarity}`,
        }));

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('sell_fish_select')
          .setPlaceholder('Select a fish to sell')
          .addOptions(options);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const embed = EmbedService.info(
          '🎣 Sell Fish',
          'Select a fish from your inventory to sell.'
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        // Create collector for select menu
        const collector = interaction.channel!.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          time: 60000,
        });

        collector.on('collect', async (i) => {
          if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'This is not your menu!', ephemeral: true });
            return;
          }

          if (i.customId === 'sell_fish_select') {
            const fishId = i.values[0];
            const result = await FishingService.sellFish(interaction.user.id, interaction.guildId!, fishId);

            const embed = EmbedService.success(
              '💰 Fish Sold',
              [
                `### ${result.emoji} ${result.name}`,
                '',
                `You received **${result.value.toLocaleString()} credits**!`,
              ].join('\n')
            )
              .setFooter({ text: `User: ${interaction.user.tag}` })
              .setTimestamp();

            await i.update({ embeds: [embed], components: [] });
          }
        });

        collector.on('end', async (collected) => {
          if (collected.size === 0) {
            await interaction.editReply({ 
              embeds: [EmbedService.warning('Expired', 'Selection menu expired.')], 
              components: [] 
            });
          }
        });
      }
    } catch (error) {
      console.error('Error in sell-fish command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while selling fish.');
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
