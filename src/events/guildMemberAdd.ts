import { Events, GuildMember, TextChannel } from 'discord.js';
import { EmbedService } from '../embeds/index.ts';
import { config } from '../config/index.ts';
import prisma from '../database/client.ts';

export default {
  name: Events.GuildMemberAdd,
  async execute(member: GuildMember) {
    // Ignore if not in configured guild
    if (member.guild.id !== config.guildId) return;

    try {
      // Check if user is returning
      const existingUser = await prisma.user.findUnique({
        where: { discordId: member.id },
      });

      const isReturning = !!existingUser;

      // Create/update user record
      await prisma.user.upsert({
        where: { discordId: member.id },
        update: {},
        create: {
          discordId: member.id,
          guildId: member.guild.id,
        },
      });

      if (!isReturning) {
        const levelZeroRole = member.guild.roles.cache.get(config.levelingRoles[0].roleId);
        const botMember = member.guild.members.me;

        if (
          levelZeroRole &&
          botMember?.permissions.has('ManageRoles') &&
          levelZeroRole.position < botMember.roles.highest.position
        ) {
          try {
            await member.roles.add(levelZeroRole, 'Assign starting level role');
          } catch (roleError) {
            console.error(`Could not assign level 0 role to ${member.id}:`, roleError);
          }
        } else {
          console.warn('Could not assign level 0 role: verify the role exists, Manage Roles is enabled, and the bot role is higher.');
        }
      }

      // Send welcome embed
      const channel = await member.guild.channels.fetch(config.welcomeChannelId) as TextChannel;
      if (!channel) {
        console.error('Welcome channel not found');
        return;
      }

      const embed = EmbedService.welcome(
        isReturning ? '👋 Welcome Back!' : '👋 Welcome to the Server!',
        `${isReturning ? 'Welcome back' : 'Welcome'} ${member.toString()} to **${member.guild.name}**!\n\n` +
        `**Username:** ${member.user.username}\n` +
        `**Display Name:** ${member.displayName}\n` +
        `**Member Count:** ${member.guild.memberCount}\n\n` +
        `${isReturning ? 'Good to see you again!' : 'Make sure to read the rules and enjoy your stay!'}`
      )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `User ID: ${member.id}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      // Send DM to user
      try {
        const dmEmbed = EmbedService.welcome(
          '👋 Welcome!',
          `Hi ${member.user.username}!\n\n` +
          `Welcome to **${member.guild.name}**! We're glad to have you here.\n\n` +
          `Make sure to read the rules and introduce yourself in the welcome channel.\n\n` +
          `If you have any questions, feel free to ask!`
        )
          .setThumbnail(member.guild.iconURL({ size: 256 }))
          .setTimestamp();

        await member.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.error('Could not send DM to user (DMs may be disabled):', dmError);
      }
    } catch (error) {
      console.error('Error in guildMemberAdd event:', error);
    }
  },
};
