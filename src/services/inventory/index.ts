import prisma from '../../database/client.ts';
import { config } from '../../config/index.ts';

export class InventoryService {
  static async getUserId(discordId: string): Promise<string> {
    const user = await prisma.user.upsert({
      where: { discordId },
      update: {},
      create: {
        discordId,
        guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
      },
    });
    return user.id;
  }

  static async addItem(discordId: string, itemId: string, quantity: number = 1) {
    const userId = await this.getUserId(discordId);
    const item = config.shopItems[itemId as keyof typeof config.shopItems];
    if (!item) {
      throw new Error('Item not found');
    }

    if (item.maxLimit) {
      const current = await prisma.inventoryItem.findUnique({
        where: {
          userId_itemId: {
            userId,
            itemId,
          },
        },
      });

      if (current && current.quantity >= item.maxLimit) {
        throw new Error(`You already have the maximum amount of this item (${item.maxLimit})`);
      }

      const newQuantity = current ? Math.min(current.quantity + quantity, item.maxLimit) : Math.min(quantity, item.maxLimit);
      
      if (current) {
        await prisma.inventoryItem.update({
          where: {
            userId_itemId: {
              userId,
              itemId,
            },
          },
          data: { quantity: newQuantity },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            userId,
            itemId,
            quantity: newQuantity,
          },
        });
      }

      return newQuantity;
    } else {
      // No limit
      await prisma.inventoryItem.upsert({
        where: {
          userId_itemId: {
            userId,
            itemId,
          },
        },
        update: {
          quantity: { increment: quantity },
        },
        create: {
          userId,
          itemId,
          quantity,
        },
      });

      const updated = await prisma.inventoryItem.findUnique({
        where: {
          userId_itemId: {
            userId,
            itemId,
          },
        },
      });

      return updated?.quantity || 0;
    }
  }

  static async removeItem(discordId: string, itemId: string, quantity: number = 1) {
    const userId = await this.getUserId(discordId);
    const current = await prisma.inventoryItem.findUnique({
      where: {
        userId_itemId: {
          userId,
          itemId,
        },
      },
    });

    if (!current) {
      throw new Error('You do not have this item');
    }

    if (current.quantity < quantity) {
      throw new Error(`You only have ${current.quantity} of this item`);
    }

    if (current.quantity === quantity) {
      await prisma.inventoryItem.delete({
        where: {
          userId_itemId: {
            userId,
            itemId,
          },
        },
      });
    } else {
      await prisma.inventoryItem.update({
        where: {
          userId_itemId: {
            userId,
            itemId,
          },
        },
        data: {
          quantity: { decrement: quantity },
        },
      });
    }

    return current.quantity - quantity;
  }

  static async getInventory(discordId: string) {
    const userId = await this.getUserId(discordId);
    return await prisma.inventoryItem.findMany({
      where: { userId },
    });
  }

  static async getItemQuantity(discordId: string, itemId: string) {
    const userId = await this.getUserId(discordId);
    const item = await prisma.inventoryItem.findUnique({
      where: {
        userId_itemId: {
          userId,
          itemId,
        },
      },
    });

    return item?.quantity || 0;
  }

  static async hasItem(discordId: string, itemId: string, quantity: number = 1) {
    const itemQuantity = await this.getItemQuantity(discordId, itemId);
    return itemQuantity >= quantity;
  }

  static async giveItem(fromDiscordId: string, toDiscordId: string, itemId: string, quantity: number = 1) {
    const item = config.shopItems[itemId as keyof typeof config.shopItems];
    if (!item) {
      throw new Error('Item not found');
    }

    if (!item.isTradeable) {
      throw new Error('This item cannot be traded');
    }

    if (fromDiscordId === toDiscordId) {
      throw new Error('You cannot give items to yourself');
    }

    // Check if sender has enough
    if (!(await this.hasItem(fromDiscordId, itemId, quantity))) {
      throw new Error(`You do not have enough of this item`);
    }

    // Check if recipient would exceed limit
    if (item.maxLimit) {
      const recipientQuantity = await this.getItemQuantity(toDiscordId, itemId);
      if (recipientQuantity + quantity > item.maxLimit) {
        throw new Error(`Recipient would exceed the maximum limit for this item`);
      }
    }

    // Transfer
    await this.removeItem(fromDiscordId, itemId, quantity);
    await this.addItem(toDiscordId, itemId, quantity);

    return true;
  }

  static async addCollectible(discordId: string, collectibleKey: string) {
    const userId = await this.getUserId(discordId);
    const collectible = config.collectibles[collectibleKey as keyof typeof config.collectibles];
    if (!collectible) {
      throw new Error('Collectible not found');
    }

    // Check if already owned
    const existing = await prisma.userCollectible.findUnique({
      where: {
        userId_collectibleId: {
          userId,
          collectibleId: collectibleKey,
        },
      },
    });

    if (existing) {
      return false; // Already owned
    }

    // Create collectible in database if it doesn't exist
    await prisma.collectible.upsert({
      where: { name: collectible.name },
      update: {},
      create: {
        name: collectible.name,
        description: `${collectible.emoji} ${collectible.name}`,
        emoji: collectible.emoji,
        rarity: collectible.rarity,
      },
    });

    // Award to user
    await prisma.userCollectible.create({
      data: {
        userId,
        collectibleId: collectibleKey,
      },
    });

    return true;
  }

  static async getCollectibles(discordId: string) {
    const userId = await this.getUserId(discordId);
    return await prisma.userCollectible.findMany({
      where: { userId },
      include: {
        collectible: true,
      },
    });
  }
}
