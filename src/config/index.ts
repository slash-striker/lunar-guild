export const config = {
  guildId: process.env.DISCORD_GUILD_ID || '1537241454693453844',
  levelUpChannelId: '1540184622757974016',
  welcomeChannelId: '1542206242762530846',
  boosterChannelId: '1537241910157246494',
  leaveChannelId: '1542208002474516570',
  economyChannelId: '1537263365376708680',
  botOwnerIds: ['1341059228626063361', '1466461677783351447'],
  botUserId: process.env.DISCORD_CLIENT_ID || '1542559878126641343',
  creditsLeaderRoleId: '1545587426876063866',
  millionaireRoleId: '1545587474640666675',
  
  // Economy settings
  dailyAmount: 1000,
  botDailyAllowance: 100000,
  workCooldown: 30 * 60 * 1000, // 30 minutes
  workBaseSalary: 50,
  workMaxSalary: 1500,
  fishingCooldown: 60 * 60 * 1000, // 1 hour
  crimeCooldown: 60 * 60 * 1000, // 1 hour
  begCooldown: 10 * 60 * 1000, // 10 minutes
  robCooldown: 24 * 60 * 60 * 1000, // 24 hours
  scratchcardCooldown: 15 * 60 * 1000, // 15 minutes
  gamesCooldown: 30 * 60 * 1000, // 30 minutes
  blackjackCooldown: 0, // 0 = no cooldown by default
  
  // Robbery settings
  robMinBalance: 500,
  robTargetMinBalance: 1000,
  robSuccessChance: 0.4,
  robStealPercentage: 0.15,
  
  // Bank robbery settings
  bankRobberyCooldown: 3 * 24 * 60 * 60 * 1000, // 3 days
  bankRobberyMaxParticipants: 10,
  bankRobberyBaseSuccessChance: 0.3,
  bankRobberyBaseReward: 5000,
  bankRobberyParticipantBonus: 1000,
  bankRobberyPenalty: 1000,
  bankrobCost: 5000,
  bankrobMinPlayers: 4,
  bankrobTimer: 60 * 1000, // 1 minute
  bankrobStealPercentage: 0.25,
  
  // Blackjack settings
  blackjackMaxBet: 10000,
  
  // Lottery settings
  lotteryCost: 2500,
  lotteryPayoutMultiplier: 2.0,
  
  // XP settings
  xpPerMessage: 10,
  xpCooldown: 60 * 1000, // 1 minute
  xpBaseRequirement: 100,
  xpMultiplier: 1.5,
  levelingRoles: [
    { level: 0, roleId: '1537582522232348702' },
    { level: 1, roleId: '1537582506579202088' },
    { level: 2, roleId: '1537582490628137061' },
    { level: 3, roleId: '1537582470256398447' },
    { level: 4, roleId: '1537582371292053574' },
    { level: 5, roleId: '1537582342342971403' },
  ],
  weeklyFreeCredits: 100000,
  
  // Job progression milestones (shifts required)
  jobMilestones: [
    { shifts: 0, name: 'Unemployed', salary: 0 },
    { shifts: 3, name: 'Deck Hand', salary: 50 },
    { shifts: 6, name: 'Sailor', salary: 75 },
    { shifts: 10, name: 'Boatswain', salary: 100 },
    { shifts: 15, name: 'Navigator', salary: 150 },
    { shifts: 25, name: 'Quartermaster', salary: 200 },
    { shifts: 40, name: 'Helmsman', salary: 300 },
    { shifts: 60, name: 'Chief Engineer', salary: 400 },
    { shifts: 85, name: 'First Mate', salary: 500 },
    { shifts: 115, name: 'Captain', salary: 650 },
    { shifts: 150, name: 'Commodore', salary: 800 },
    { shifts: 200, name: 'Admiral', salary: 1000 },
    { shifts: 275, name: 'Fleet Commander', salary: 1200 },
    { shifts: 365, name: 'Grand Admiral', salary: 1350 },
    { shifts: 465, name: 'Naval Supreme', salary: 1500 },
  ],
  
  // Shop items
  shopItems: {
    coffee: { name: 'Coffee', price: 100, description: 'Improves work outcomes - chance for 2x salary', category: 'consumable', isTradeable: true, maxLimit: 999, emoji: '☕' },
    energyDrink: { name: 'Energy Drink', price: 150, description: 'Additional bonus on work salary', category: 'consumable', isTradeable: true, maxLimit: undefined, emoji: '🥤' },
    magicFishingHook: { name: 'Magic Fishing Hook', price: 300, description: 'Increases chance of catching rare fish', category: 'tool', isTradeable: true, maxLimit: undefined, emoji: '🎣' },
    luckyDice: { name: 'Lucky Dice', price: 300, description: 'Improves luck in games and robberies', category: 'tool', isTradeable: true, maxLimit: 999, emoji: '🎲' },
    watchdog: { name: 'Watchdog', price: 1500, description: 'Protects against robberies (max 3)', category: 'protection', isTradeable: true, maxLimit: 3, emoji: '🐕' },
    mobilePhone: { name: 'Mobile Phone', price: 5000, description: 'Notifies you of bank robbery attempts', category: 'tool', isTradeable: true, maxLimit: 1, emoji: '📱' },
    mysteryBox: { name: 'Mystery Box', price: 3000, description: 'Random rewards - opens immediately', category: 'special', isTradeable: false, maxLimit: 1, emoji: '🎁' },
    luckyMysteryBox: { name: 'Lucky Mystery Box', price: 5000, description: 'Better mystery box rewards', category: 'special', isTradeable: false, maxLimit: 1, emoji: '🎊' },
  },
  
  // Collectibles
  collectibles: {
    tropicalFish: { name: 'Tropical Fish', emoji: '🐠', rarity: 'legendary', chance: 0.001 },
    moneyBag: { name: 'Money Bag', emoji: '💰', rarity: 'legendary', chance: 0.001 },
    diamond: { name: 'Diamond', emoji: '💎', rarity: 'legendary', chance: 0.001 },
    ninja: { name: 'Ninja', emoji: '🥷', rarity: 'legendary', chance: 0.001 },
    oldShoe: { name: 'Old Shoe', emoji: '👟', rarity: 'common', chance: 0.001 },
    oneMillionTrophy: { name: '1 Million Trophy', emoji: '🏆', rarity: 'mythic', chance: 0 },
  },
  
  // Fishing rewards
  fishRewards: [
    { name: 'Old Boot', emoji: '👢', chance: 0.4, reward: 600 },
    { name: 'Tin Can', emoji: '🥫', chance: 0.3, reward: 700 },
    { name: 'Common Fish', emoji: '🐟', chance: 0.2, reward: 800 },
    { name: 'Uncommon Fish', emoji: '🐡', chance: 0.08, reward: 900 },
    { name: 'Rare Fish', emoji: '🦈', chance: 0.019, reward: 1000 },
    { name: 'Tropical Fish', emoji: '🐠', chance: 0.001, reward: 0, isCollectible: true },
  ],
  
  // Scratchcard rewards
  scratchcardRewards: {
    min: 1000,
    max: 4000,
    moneyBagChance: 0.001,
  },
  
  // Coffee effects
  coffeeEffects: {
    earlyChance: 0.3, // 30% chance for 2x salary
    onTimeChance: 0.5, // 50% chance for normal salary
    lateChance: 0.2, // 20% chance for 50% salary (without coffee)
  },
  
  // Energy drink bonus
  energyDrinkBonus: 25, // Additional credits
  
  // Magic fishing hook bonus
  magicHookBonus: 0.15, // 15% increased rare fish chance
  
  // Lucky dice bonus
  luckyDiceBonus: 0.1, // 10% increased success chance
  
  // Watchdog protection
  watchdogProtection: 0.15, // 15% increased robbery failure chance per watchdog
  
  // Game rewards
  gameRewards: {
    matchPairs: 500,
    fiveDice: { three: 100, four: 300, five: 1000 },
    lightsOut: 300,
    mastermind: 400,
    hangman: 200,
    highLow: { win: 100, loss: 50 },
    rps: 50,
    ticTacToe: 100,
  },
};

export function isOwner(userId: string): boolean {
  return config.botOwnerIds.includes(userId);
}
