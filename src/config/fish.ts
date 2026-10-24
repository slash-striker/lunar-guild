export const FISH_DATA = [
  // Common (60% total catch rate)
  { name: 'Sardine', emoji: '🐟', rarity: 'common', value: 10, catchRate: 0.15, minWeight: 0.1, maxWeight: 0.5, description: 'A small, common fish.' },
  { name: 'Anchovy', emoji: '🐟', rarity: 'common', value: 12, catchRate: 0.12, minWeight: 0.1, maxWeight: 0.3, description: 'Tiny but plentiful.' },
  { name: 'Minnow', emoji: '🐟', rarity: 'common', value: 8, catchRate: 0.12, minWeight: 0.05, maxWeight: 0.2, description: 'Very small fish.' },
  { name: 'Carp', emoji: '🐟', rarity: 'common', value: 15, catchRate: 0.10, minWeight: 0.5, maxWeight: 3.0, description: 'A common freshwater fish.' },
  { name: 'Perch', emoji: '🐟', rarity: 'common', value: 18, catchRate: 0.11, minWeight: 0.3, maxWeight: 2.0, description: 'A popular panfish.' },

  // Uncommon (25% total catch rate)
  { name: 'Bass', emoji: '🐠', rarity: 'uncommon', value: 35, catchRate: 0.08, minWeight: 1.0, maxWeight: 5.0, description: 'A prized game fish.' },
  { name: 'Trout', emoji: '🐠', rarity: 'uncommon', value: 40, catchRate: 0.07, minWeight: 0.5, maxWeight: 4.0, description: 'Freshwater favorite.' },
  { name: 'Salmon', emoji: '🐠', rarity: 'uncommon', value: 50, catchRate: 0.06, minWeight: 2.0, maxWeight: 10.0, description: 'A delicious fish.' },
  { name: 'Catfish', emoji: '🐠', rarity: 'uncommon', value: 45, catchRate: 0.04, minWeight: 1.0, maxWeight: 8.0, description: 'Bottom-dwelling fish.' },

  // Rare (10% total catch rate)
  { name: 'Tuna', emoji: '🐡', rarity: 'rare', value: 100, catchRate: 0.04, minWeight: 5.0, maxWeight: 50.0, description: 'Fast and valuable.' },
  { name: 'Swordfish', emoji: '🐡', rarity: 'rare', value: 120, catchRate: 0.03, minWeight: 10.0, maxWeight: 100.0, description: 'A formidable predator.' },
  { name: 'Mahi Mahi', emoji: '🐡', rarity: 'rare', value: 110, catchRate: 0.03, minWeight: 5.0, maxWeight: 30.0, description: 'Colorful and tasty.' },

  // Epic (4% total catch rate)
  { name: 'Marlin', emoji: '🦈', rarity: 'epic', value: 250, catchRate: 0.02, minWeight: 50.0, maxWeight: 200.0, description: 'A legendary sport fish.' },
  { name: 'Sturgeon', emoji: '🦈', rarity: 'epic', value: 300, catchRate: 0.02, minWeight: 20.0, maxWeight: 100.0, description: 'Ancient and valuable.' },

  // Legendary (0.9% total catch rate)
  { name: 'Whale Shark', emoji: '🐋', rarity: 'legendary', value: 1000, catchRate: 0.005, minWeight: 500.0, maxWeight: 2000.0, description: 'A gentle giant.' },
  { name: 'Giant Squid', emoji: '🦑', rarity: 'legendary', value: 1200, catchRate: 0.004, minWeight: 100.0, maxWeight: 500.0, description: 'Deep sea mystery.' },

  // Mythic (0.1% total catch rate)
  { name: 'Golden Koi', emoji: '✨', rarity: 'mythic', value: 5000, catchRate: 0.0005, minWeight: 1.0, maxWeight: 5.0, description: 'A fish of legend.' },
  { name: 'Leviathan', emoji: '👑', rarity: 'mythic', value: 10000, catchRate: 0.0005, minWeight: 1000.0, maxWeight: 5000.0, description: 'The king of the sea.' },
];

// Every catch is worthwhile, while rare fish receive a substantial payout bonus.
export const FISH_PAYOUT_CONFIG = {
  common: { minimum: 350, multiplier: 1 },
  uncommon: { minimum: 750, multiplier: 1.25 },
  rare: { minimum: 1500, multiplier: 1.5 },
  epic: { minimum: 3000, multiplier: 1.75 },
  legendary: { minimum: 7500, multiplier: 2 },
  mythic: { minimum: 15000, multiplier: 2.5 },
} as const;

export const RARITY_COLORS = {
  common: 0x808080,      // Gray
  uncommon: 0x00FF00,    // Green
  rare: 0x0000FF,        // Blue
  epic: 0x9400D3,        // Purple
  legendary: 0xFFA500,   // Orange
  mythic: 0xFFD700,      // Gold
};

export const RARITY_EMOJIS = {
  common: '⚪',
  uncommon: '🟢',
  rare: '🔵',
  epic: '🟣',
  legendary: '🟠',
  mythic: '🟡',
};
