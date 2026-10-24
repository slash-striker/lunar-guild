import { Events, Message } from 'discord.js';
import { LevelService } from '../services/leveling/index.ts';
import { CooldownService } from '../services/cooldowns/index.ts';
import { config } from '../config/index.ts';
import { client } from '../index.ts';

export default {
  name: Events.MessageCreate,
  async execute(message: Message) {
    // Ignore bot messages
    if (message.author.bot) return;

    // Ignore DMs
    if (!message.guild) return;

    // Ignore messages not in the configured guild
    if (message.guildId !== config.guildId) return;

    // Check XP cooldown
    const canGainXP = await CooldownService.checkCooldown(
      message.author.id,
      'xp_gain',
      config.xpCooldown
    );

    if (canGainXP === null) {
      await LevelService.addXP(message.author.id, config.xpPerMessage, client);
      await CooldownService.setCooldown(message.author.id, 'xp_gain', config.xpCooldown);
    }
  },
};
