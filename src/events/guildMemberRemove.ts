import { Events, GuildMember, TextChannel } from 'discord.js';
import { EmbedService } from '../embeds/index.ts';
import { config } from '../config/index.ts';

export default {
  name: Events.GuildMemberRemove,
  async execute(member: GuildMember) {
    // Ignore if not in configured guild
    if (member.guild.id !== config.guildId) return;

    try {
      // Send leave embed
      const channel = await member.guild.channels.fetch(config.leaveChannelId) as TextChannel;
      if (!channel) {
        console.error('Leave channel not found');
        return;
      }

      const embed = EmbedService.info(
        '👋 Member Left',
        `**Username:** ${member.user.username}\n` +
        `**Display Name:** ${member.displayName}\n\n` +
        `We'll miss you!`
      )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `User ID: ${member.id}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      // Send DM to user
      try {
        const dmEmbed = EmbedService.info(
          '👋 Goodbye!',
          `Hi ${member.user.username}!\n\n` +
          `We're sad to see you leave **${member.guild.name}**.\n\n` +
          `If you ever want to come back, you'll always be welcome!\n\n` +
          `Take care!`
        )
          .setThumbnail(member.guild.iconURL({ size: 256 }))
          .setTimestamp();

        await member.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.error('Could not send DM to user (DMs may be disabled):', dmError);
      }
    } catch (error) {
      console.error('Error in guildMemberRemove event:', error);
    }
  },
};
