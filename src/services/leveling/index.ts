import prisma from '../../database/client.ts';
import { config } from '../../config/index.ts';
import { EmbedService } from '../../embeds/index.ts';
import { DiscordAPIError } from 'discord.js';
import type { Client, GuildMember, TextChannel } from 'discord.js';

export class LevelService {
  static async getUserLevel(discordId: string) {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: { level: true },
    });

    return user?.level || null;
  }

  static async ensureUserLevel(discordId: string) {
    // First ensure user exists
    const user = await prisma.user.upsert({
      where: { discordId },
      update: {},
      create: {
        discordId,
        guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
      },
    });

    return await prisma.level.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        level: 1,
        xp: 0,
        totalMessageCount: 0,
      },
    });
  }

  static calculateXPRequirement(level: number): number {
    return Math.floor(config.xpBaseRequirement * Math.pow(config.xpMultiplier, level - 1));
  }

  static async addXP(discordId: string, xpAmount: number, client: Client): Promise<void> {
    const levelData = await this.ensureUserLevel(discordId);
    
    let newXP = levelData.xp + xpAmount;
    const currentLevel = levelData.level;
    const xpForNextLevel = this.calculateXPRequirement(currentLevel + 1);
    
    let newLevel = currentLevel;

    // Check for level up
    while (newXP >= xpForNextLevel && newLevel < 100) { // Cap at level 100
      newXP -= xpForNextLevel;
      newLevel++;
    }

    // Update level data
    await prisma.level.update({
      where: { userId: levelData.userId },
      data: {
        xp: newXP,
        level: newLevel,
        totalMessageCount: { increment: 1 },
        lastXPGainAt: new Date(),
      },
    });

    const guild = await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(discordId);
    await this.syncLevelRole(member, newLevel);

    // Check if user leveled up
    if (newLevel > currentLevel) {
      await this.sendLevelUpNotification(discordId, newLevel, client);
    }
  }

  static async sendLevelUpNotification(discordId: string, newLevel: number, client: Client): Promise<void> {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const member = await guild.members.fetch(discordId);
      const channel = await client.channels.fetch(config.levelUpChannelId) as TextChannel;

      if (!channel) {
        console.error('Level-up channel not found');
        return;
      }

      const xpForNextLevel = this.calculateXPRequirement(newLevel + 1);
      const levelData = await this.getUserLevel(discordId);

      const embed = EmbedService.leveling(
        '🎉 Level Up!',
        `Congratulations ${member.toString()}!\n\n` +
        `**New Level:** ${newLevel}\n` +
        `**Current XP:** ${levelData?.xp || 0}\n` +
        `**XP Required for Level ${newLevel + 1}:** ${xpForNextLevel}\n\n` +
        `Keep chatting to level up further!`
      )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `User ID: ${discordId}` });

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error sending level-up notification:', error);
    }

  }

  private static async syncLevelRole(member: GuildMember, level: number): Promise<void> {
      const eligibleRole = [...config.levelingRoles]
        .filter((entry) => level >= entry.level)
        .sort((a, b) => b.level - a.level)[0];

      if (!eligibleRole) return;

      const botMember = member.guild.members.me;
      const role = member.guild.roles.cache.get(eligibleRole.roleId);
      if (
        !botMember ||
        !role ||
        !botMember.permissions.has('ManageRoles') ||
        role.position >= botMember.roles.highest.position ||
        member.roles.highest.position >= botMember.roles.highest.position
      ) {
        console.warn(`Unable to synchronize level role ${eligibleRole.roleId}: missing Manage Roles permission or role hierarchy is invalid.`);
        return;
      }

      const levelingRoleIds = config.levelingRoles.map((entry) => entry.roleId);
      const rolesToRemove = levelingRoleIds.filter((roleId) => {
        const roleToRemove = member.guild.roles.cache.get(roleId);
        return roleId !== eligibleRole.roleId &&
          member.roles.cache.has(roleId) &&
          !!roleToRemove &&
          roleToRemove.position < botMember.roles.highest.position;
      });

      try {
        if (rolesToRemove.length > 0) {
          await member.roles.remove(rolesToRemove);
        }
        if (!member.roles.cache.has(eligibleRole.roleId)) {
          await member.roles.add(eligibleRole.roleId);
        }
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50013) {
          console.warn(`Discord denied level role synchronization for ${member.id}. Check Manage Roles and role hierarchy.`);
          return;
        }
        throw error;
      }
  }

  static async getLeaderboard(limit: number = 10, offset: number = 0) {
    return await prisma.level.findMany({
      include: {
        user: true,
      },
      orderBy: [
        { level: 'desc' },
        { xp: 'desc' },
      ],
      take: limit,
      skip: offset,
    });
  }

  static async getUserRank(discordId: string): Promise<number | null> {
    const levels = await prisma.level.findMany({
      where: { user: { guildId: config.guildId } },
      select: { user: { select: { discordId: true } }, level: true, xp: true },
    });
    levels.sort((a, b) => b.level - a.level || b.xp - a.xp);
    const index = levels.findIndex((entry) => entry.user.discordId === discordId);
    return index === -1 ? null : index + 1;
  }

  static async editXP(discordId: string, newXP: number): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { discordId },
    });

    if (!user) throw new Error('User not found');

    await prisma.level.update({
      where: { userId: user.id },
      data: { xp: newXP },
    });
  }

  static async resetXP(discordId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { discordId },
    });

    if (!user) throw new Error('User not found');

    await prisma.level.update({
      where: { userId: user.id },
      data: {
        xp: 0,
        level: 1,
        totalMessageCount: 0,
      },
    });
  }

  static async resetLeaderboard(): Promise<void> {
    await prisma.level.updateMany({
      data: {
        xp: 0,
        level: 1,
        totalMessageCount: 0,
      },
    });
  }
}
