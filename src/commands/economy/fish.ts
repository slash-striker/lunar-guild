import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { FishingService } from '../../services/economy/fishing.ts';
import { CooldownService } from '../../services/cooldowns/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { RARITY_COLORS, RARITY_EMOJIS } from '../../config/fish.ts';
import prisma from '../../database/client.ts';

export default {
  data: new SlashCommandBuilder()
    .setName('fish')
    .setDescription('Go fishing to catch fish and earn credits'),

  async execute(interaction: ChatInputCommandInteraction) {
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

      // Check cooldown
      const cooldown = await CooldownService.checkCooldown(interaction.user.id, 'fish');

      if (cooldown !== null) {
        const embed = EmbedService.warning(
          'Cooldown Active',
          `You can fish again in **${cooldown}**`
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // Fish
      const result = await FishingService.fish(interaction.user.id, interaction.guildId!);
      await CooldownService.setCooldown(interaction.user.id, 'fish');

      // Dramatic pause - first show casting message
      await interaction.editReply({ 
        embeds: [EmbedService.info('🎣 Fishing', 'Casting your line...')] 
      });

      // Wait 2 seconds for dramatic effect
      await new Promise(resolve => setTimeout(resolve, 2000));

      const rarityEmoji = RARITY_EMOJIS[result.rarity as keyof typeof RARITY_EMOJIS];
      const rarityColor = RARITY_COLORS[result.rarity as keyof typeof RARITY_COLORS];

      let description = `You caught a **${result.emoji} ${result.name}**!\n\n`;
      description += `${rarityEmoji} **${result.rarity.charAt(0).toUpperCase() + result.rarity.slice(1)}**\n`;
      description += `⚖️ **Weight**: ${result.weight.toFixed(2)} kg\n`;
      description += `💰 **Value**: ${result.value.toLocaleString()} credits\n\n`;
      description += `*${result.description}*\n\n`;
      description += `Use \`/sell-fish\` to sell your catch or \`/fish-collection\` to view your inventory.`;

      const embed = EmbedService.success(
        '🎣 Fishing Result',
        description
      )
        .setColor(rarityColor)
        .setFooter({ text: `User: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in fish command:', error);
      const embed = EmbedService.error('Error', 'An error occurred while fishing.');
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
