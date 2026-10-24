import { EconomyService } from './index.ts';
import { FISHING_EQUIPMENT, type EquipmentType } from '../../config/fishing-equipment.ts';
import prisma from '../../database/client.ts';
type FishingEquipmentItem = {
  name: string;
  emoji: string;
  price: number;
  description: string;
  tier: number;
  [key: string]: unknown;
};
export class FishingTycoonService {
  // FISHING_EQUIPMENT uses plural collection keys (rods, hooks, boats) while
  // equipment types are singular (rod, hook, boat).
  static readonly EQUIPMENT_COLLECTION: Record<EquipmentType, keyof typeof FISHING_EQUIPMENT> = {
    rod: 'rods',
    hook: 'hooks',
    bait: 'bait',
    boat: 'boats',
    water: 'water',
  };

  private static getEquipmentCollection(type: EquipmentType) {
    return FISHING_EQUIPMENT[this.EQUIPMENT_COLLECTION[type]] as Record<string, {
      name: string;
      emoji: string;
      price: number;
      description: string;
      tier: number;
    }>;
  }

  static async getEquipment(discordId: string) {
    const user = await prisma.user.findFirst({
      where: { discordId },
      include: { fishingEquipment: true },
    });

    if (!user?.fishingEquipment) {
      // Create default equipment
      const equipment = await prisma.fishingEquipment.create({
        data: {
          userId: user!.id,
          rod: 'basic',
          hook: 'basic',
          bait: 'worm',
          boat: 'none',
          water: 'shore',
        },
      });
      return equipment;
    }

    return user.fishingEquipment;
  }

  static async upgradeEquipment(
    discordId: string,
    type: EquipmentType,
    upgradeKey: string
  ) {
    const equipment = await this.getEquipment(discordId);

    const currentKey = equipment[type as keyof typeof equipment] as string;

    const equipmentType = this.getEquipmentCollection(type as EquipmentType);

    const upgrade = equipmentType[upgradeKey];

    if (!upgrade) {
      throw new Error('Invalid equipment upgrade');
    }

    // Check if user already has this upgrade
    if (currentKey === upgradeKey) {
      throw new Error('You already have this equipment');
    }

    // Check if upgrade is higher tier
    const currentUpgrade = equipmentType[currentKey];
    const currentTier = currentUpgrade?.tier ?? 0;

    if (upgrade.tier <= currentTier) {
      throw new Error('You can only upgrade to higher tier equipment');
    }

    // Check balance
    const balance = await EconomyService.getBalance(discordId);

    if (balance.wallet < upgrade.price) {
      throw new Error(
        `You need ${upgrade.price.toLocaleString()} credits to buy this upgrade`
      );
    }

    // Remove credits
    await EconomyService.removeCredits(
      discordId,
      upgrade.price,
      `Purchased ${upgrade.name}`,
      'FISHING_TYCOON'
    );

    // Update equipment
    await prisma.fishingEquipment.update({
      where: { userId: equipment.userId },
      data: { [type]: upgradeKey },
    });

    return upgrade;
  }

  static async getEquipmentBonuses(discordId: string) {
    const equipment = await this.getEquipment(discordId);
    
    const rod = FISHING_EQUIPMENT.rods[equipment.rod as keyof typeof FISHING_EQUIPMENT.rods];
    const hook = FISHING_EQUIPMENT.hooks[equipment.hook as keyof typeof FISHING_EQUIPMENT.hooks];
    const bait = FISHING_EQUIPMENT.bait[equipment.bait as keyof typeof FISHING_EQUIPMENT.bait];
    const boat = FISHING_EQUIPMENT.boats[equipment.boat as keyof typeof FISHING_EQUIPMENT.boats];
    const water = FISHING_EQUIPMENT.water[equipment.water as keyof typeof FISHING_EQUIPMENT.water];

    return {
      catchRateBonus: (rod?.catchRateBonus || 0) + (hook?.catchSuccessBonus || 0),
      rarityBonus: rod?.rarityBonus || 0,
      valueBonus: bait?.valueBonus || 0,
      varietyBonus: (bait?.varietyBonus || 0) + (water?.fishTypeBonus || 0),
      capacityBonus: boat?.capacityBonus || 0,
      specialFishBonus: boat?.specialFishBonus || 0,
    };
  }

  static async getAvailableUpgrades(discordId: string) {
    const equipment = await this.getEquipment(discordId);

    const upgrades: Array<{
      type: EquipmentType;
      key: string;
      name: string;
      emoji: string;
      price: number;
      description: string;
      tier: number;
    }> = [];

    for (const type of ['rod', 'hook', 'bait', 'boat', 'water'] as EquipmentType[]) {
      const currentKey = equipment[type] as string;

      const equipmentType = this.getEquipmentCollection(type);

      const currentTier = equipmentType[currentKey]?.tier ?? 0;

      for (const [key, item] of Object.entries(equipmentType)) {
        if (item.tier > currentTier) {
          upgrades.push({
            type,
            key,
            ...item,
          });
        }
      }
    }

    return upgrades;
  }
}
