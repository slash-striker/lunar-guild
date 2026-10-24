import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { EmbedService } from '../../embeds/index.ts';
import { EconomyService } from '../../services/economy/index.ts';
import { isOwner } from '../../config/index.ts';
import prisma from '../../database/client.ts';

const MAX_GIVEAWAY_DAYS = 24;
const GAME_TYPE = 'giveaway';

type GiveawayPayload = {
  amount: number;
  endsAt: number;
  guildId: string;
  channelId: string;
  messageId: string;
  creatorId: string;
  entrants: string[];
};

export default {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Launch a credit giveaway (admin only)')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Credits awarded to the winner')
        .setMinValue(1)
        .setMaxValue(1_000_000)
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('How long entries stay open')
        .setMinValue(1)
        .setMaxValue(MAX_GIVEAWAY_DAYS)
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id) && !interaction.memberPermissions?.has('Administrator')) {
      return interaction.reply({
        embeds: [EmbedService.error('Permission Denied', 'This command is restricted to administrators.')],
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger('amount', true);
    const days = interaction.options.getInteger('days', true);
    const endsAt = Date.now() + days * 24 * 60 * 60 * 1000;

    // Ensure the creator exists so the session has a valid user relation
    const creator = await prisma.user.upsert({
      where: { discordId: interaction.user.id },
      update: {},
      create: {
        discordId: interaction.user.id,
        guildId: interaction.guildId!,
      },
    });

    const button = new ButtonBuilder()
      .setCustomId(`giveaway_join:${interaction.id}`)
      .setLabel('Join Giveaway')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    const message = await interaction.reply({
      embeds: [renderEmbed({ amount, endsAt, entrants: [] })],
      components: [row],
      fetchReply: true,
    });

    const payload: GiveawayPayload = {
      amount,
      endsAt,
      guildId: interaction.guildId!,
      channelId: interaction.channelId,
      messageId: message.id,
      creatorId: interaction.user.id,
      entrants: [],
    };

    await prisma.gameSession.create({
      data: {
        userId: creator.id,
        gameType: GAME_TYPE,
        state: 'active',
        payload: JSON.stringify(payload),
      },
    });

    // Also collect live in this process so embed updates feel instant.
    // Payout is handled exclusively by the persistent scheduler below.
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: days * 24 * 60 * 60 * 1000,
    });

    collector.on('collect', async component => {
      if (component.customId.startsWith('giveaway_join:')) {
        await handleGiveawayJoinButton(component);
      }
    });
  },
};

function renderEmbed(payload: Pick<GiveawayPayload, 'amount' | 'endsAt' | 'entrants'>) {
  return EmbedService.economy(
    '🎁 Lunar Credit Giveaway',
    `Click **Join Giveaway** for a chance to win **${payload.amount.toLocaleString()} credits**.\n\n` +
    `Every entrant has an equal chance of winning.`,
  )
    .addFields(
      { name: '👥 Entrants', value: `${payload.entrants.length} joined`, inline: true },
      { name: '⏳ Closes', value: `<t:${Math.floor(payload.endsAt / 1000)}:R>`, inline: true },
      { name: '💰 Prize', value: `${payload.amount.toLocaleString()} credits`, inline: true },
    )
    .setFooter({ text: 'One random winner • Prize paid from the bot wallet' });
}

/** Route for giveaway_join button interactions (called from interactionCreate). */
export async function handleGiveawayJoinButton(component: ButtonInteraction): Promise<void> {
  try {
    const session = await findSessionByMessageId(component.message.id);
    if (!session || session.state !== 'active') {
      await component.reply({ content: 'This giveaway has already ended.', ephemeral: true });
      return;
    }

    const payload = parsePayload(session.payload);
    if (payload.endsAt <= Date.now()) {
      await component.reply({ content: 'This giveaway has already ended.', ephemeral: true });
      return;
    }

    if (payload.entrants.includes(component.user.id)) {
      await component.reply({ content: 'You are already entered.', ephemeral: true });
      return;
    }

    payload.entrants.push(component.user.id);
    await prisma.gameSession.update({
      where: { id: session.id },
      data: { payload: JSON.stringify(payload) },
    });

    await component.update({
      embeds: [renderEmbed(payload)],
      components: buildComponents(session.payload, payload),
    });
  } catch (error) {
    console.error('Error handling giveaway join:', error);
    if (!component.replied && !component.deferred) {
      await component.reply({ content: 'Something went wrong joining the giveaway.', ephemeral: true }).catch(() => {});
    }
  }
}

function buildComponents(originalPayload: string, payload: GiveawayPayload) {
  // Preserve the original button customId so the component stays routable
  const original = JSON.parse(originalPayload) as GiveawayPayload;
  void payload;
  const button = new ButtonBuilder()
    .setCustomId(`giveaway_join:${original.messageId}`)
    .setLabel('Join Giveaway')
    .setEmoji('🎟️')
    .setStyle(ButtonStyle.Success);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
}

async function findSessionByMessageId(messageId: string) {
  const sessions = await prisma.gameSession.findMany({
    where: { gameType: GAME_TYPE, state: 'active' },
  });
  return sessions.find(s => {
    try {
      return (JSON.parse(s.payload) as GiveawayPayload).messageId === messageId;
    } catch {
      return false;
    }
  });
}

function parsePayload(raw: string): GiveawayPayload {
  return JSON.parse(raw) as GiveawayPayload;
}

/**
 * Resume all active giveaways after a restart: immediately end any whose
 * deadline passed while the bot was offline, and schedule the rest.
 */
export async function scheduleGiveaways(client: Client): Promise<void> {
  const sessions = await prisma.gameSession.findMany({
    where: { gameType: GAME_TYPE, state: 'active' },
  });

  const now = Date.now();
  for (const session of sessions) {
    const payload = parsePayload(session.payload);
    const delay = Math.max(0, payload.endsAt - now);
    setTimeout(() => {
      endGiveaway(client, session.id).catch(error =>
        console.error(`Giveaway ${session.id} failed to end:`, error),
      );
    }, delay);
  }

  if (sessions.length > 0) {
    console.log(`🎁 Resumed ${sessions.length} active giveaway(s)`);
  }
}

export async function endGiveaway(client: Client, sessionId: string): Promise<void> {
  // Atomically claim the session so concurrent timers cannot double-pay
  const session = await prisma.gameSession.findUnique({ where: { id: sessionId } });
  if (!session || session.state !== 'active') return;

  const claimed = await prisma.gameSession.updateMany({
    where: { id: sessionId, state: 'active' },
    data: { state: 'completed' },
  });
  if (claimed.count === 0) return;

  const payload = parsePayload(session.payload);

  const button = new ButtonBuilder()
    .setCustomId(`giveaway_join:${payload.messageId}`)
    .setLabel('Join Giveaway')
    .setEmoji('🎟️')
    .setStyle(ButtonStyle.Success)
    .setDisabled(true);
  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  const winnerId = payload.entrants[Math.floor(Math.random() * payload.entrants.length)];

  try {
    const channel = await client.channels.fetch(payload.channelId);
    if (!channel || !channel.isTextBased()) throw new Error('Giveaway channel not found');
    const message = await channel.messages.fetch(payload.messageId);

    if (!winnerId) {
      await message.edit({
        embeds: [EmbedService.warning('Giveaway Ended', 'No one joined this giveaway.')],
        components: [disabledRow],
      });
      return;
    }

    try {
      await EconomyService.transferCreditsFromBalances(
        client.user!.id,
        winnerId,
        payload.amount,
        `Giveaway winner ${winnerId}`,
      );
      await message.edit({
        embeds: [EmbedService.success(
          '🏆 Giveaway Complete',
          `Winner: <@${winnerId}>\n\n**${payload.amount.toLocaleString()} credits** were transferred successfully.`,
        )],
        components: [disabledRow],
      });
    } catch (error) {
      console.error('Giveaway payout failed:', error);
      await message.edit({
        embeds: [EmbedService.error(
          'Giveaway Failed',
          'The giveaway could not pay out because the bot wallet does not have enough credits.',
        )],
        components: [disabledRow],
      });
    }
  } catch (error) {
    console.error(`Could not announce giveaway ${sessionId}:`, error);
  }
}
