import { EmbedBuilder } from 'discord.js';
import type { ColorResolvable } from 'discord.js';


export const EmbedType = {
    ECONOMY: 0x57F287,
    SUCCESS: 0x57F287,
    ERROR: 0xED4245,
    LEVELING: 0x5865F2,
    GAMES: 0x3BA55C,
    ADMIN: 0xED4245,
    COLLECTIBLE: 0xFAA61A,
    WELCOME: 0x5865F2,
    INFO: 0x5865F2,
    WARNING: 0xFAA61A,
} as const;


export class EmbedService {
  static createEmbed(
    type: (typeof EmbedType)[keyof typeof EmbedType],
    title: string,
    description?: string,
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(type as ColorResolvable)
      .setTitle(title)
      .setTimestamp();

    if (description) {
      embed.setDescription(description);
    }

    return embed;
  }

  static economy(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.ECONOMY, title, description);
  }

  static success(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.SUCCESS, title, description);
  }

  static error(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.ERROR, title, description);
  }

  static leveling(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.LEVELING, title, description);
  }

  static games(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.GAMES, title, description);
  }

  static admin(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.ADMIN, title, description);
  }

  static collectible(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.COLLECTIBLE, title, description);
  }

  static welcome(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.WELCOME, title, description);
  }

  static info(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.INFO, title, description);
  }

  static warning(title: string, description?: string): EmbedBuilder {
    return this.createEmbed(EmbedType.WARNING, title, description);
  }
}
