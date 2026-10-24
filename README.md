# Lunar Guild Discord Bot

A production-ready Discord bot for the Lunar Guild server featuring a complete economy system, leveling, games, and more.

## Features

- **Economy System**: Wallet, bank, transactions, and audit logs
- **Leveling System**: XP-based leveling with level-up notifications
- **Work System**: Job progression with promotions and salary increases
- **Shop & Inventory**: Buy items, manage inventory, collectibles
- **Fishing**: Catch fish for credits and rare collectibles
- **Robbery**: Rob other users (with risks and rewards)
- **Crime & Beg**: Additional ways to earn credits
- **Cooldown System**: Persistent cooldowns stored in database
- **Transaction Logging**: All currency changes are logged
- **Owner Commands**: Admin tools for managing the economy

## Requirements

- Node.js 18+ 
- PostgreSQL database
- Discord bot token
- Discord application with bot permissions

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

4. Set up PostgreSQL database and add the connection string to `.env`

## Environment Variables

Create a `.env` file with the following variables:

```env
# Discord
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
DISCORD_GUILD_ID=your_server_id_here

# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Security
BOT_OWNER_ID=your_discord_user_id

# Optional
NODE_ENV=development
LOG_LEVEL=info
```

## Database Setup

1. Generate Prisma client:
```bash
npm run prisma:generate
```

2. Run migrations:
```bash
npm run prisma:migrate
```
For a deployed bot, use the production migration command with a direct (non-pooled)
PostgreSQL connection:
```bash
npm run prisma:deploy
```

3. (Optional) Open Prisma Studio to view data:
```bash
npm run prisma:studio
```

## Discord Bot Setup

1. Create a Discord application at https://discord.com/developers/applications
2. Enable bot and get your token
3. Add the bot to your server with the following permissions:
   - Read Messages/View Channels
   - Send Messages
   - Embed Links
   - Use Slash Commands
   - Read Message History
   - Add Reactions
   - Manage Roles (for level roles if needed)

## Development

Start the bot in development mode:
```bash
npm run dev
```

This will use nodemon to automatically restart when files change.

## Deploy Commands

Register slash commands with Discord:
```bash
npm run deploy-commands
```

This registers commands to your development guild for instant updates.

## Production

Build the TypeScript code:
```bash
npm run build
```

Start the bot:
```bash
npm start
```

## Configuration

The bot uses a centralized configuration system in `src/config/index.ts`. Key settings include:

- Server channel IDs (economy, level-up, welcome, etc.)
- Economy values (daily amount, work salary, etc.)
- Cooldown durations
- Shop items and prices
- Job progression milestones
- Fishing rewards
- Robbery settings

To change the economy channel or other settings, modify the config file or use admin commands (when implemented).

## Commands

### Economy Commands

- `/balance` - Check your wallet, bank, and net worth
- `/daily` - Claim your daily bonus (1,000 credits, 24h cooldown)
- `/credits give <user> <amount>` - Give credits to another user
- `/credits add <user> <amount>` - (Owner) Add credits to a user
- `/credits remove <user> <amount>` - (Owner) Remove credits from a user
- `/credits audit [user]` - View transaction history
- `/bank deposit <amount>` - Deposit credits to bank
- `/bank withdraw <amount>` - Withdraw credits from bank
- `/work` - Work to earn credits (4h cooldown)
- `/shop view` - View available shop items
- `/shop buy <item>` - Purchase an item
- `/inventory [user]` - View your or another user's inventory
- `/fish` - Go fishing (30s cooldown)
- `/rob <user>` - Attempt to rob another user (5m cooldown)
- `/crime` - Commit a crime for credits (1h cooldown)
- `/beg` - Beg for small credits (1m cooldown)
- `/bankrob` - Start or join a bank robbery (24h cooldown)
- `/ec-stats [user]` - View economy statistics
- `/ec-leaderboard [type] [page]` - View economy leaderboard (wallet/bank/networth)
- `/lottery buy` - Buy a lottery ticket (2,500 credits)
- `/lottery info` - View current lottery information
- `/lottery history` - View past lottery results

### Leveling Commands

- `/level [user]` - View your or another user's level and XP
- `/leaderboard [page]` - View the level leaderboard
- `/level-admin edit-xp <user> <amount>` - (Owner) Edit a user's XP
- `/level-admin reset-xp <user>` - (Owner) Reset a user's XP and level
- `/level-admin reset-leaderboard` - (Owner) Reset the entire level leaderboard

### Games Commands

- `/scratchcard` - Buy a scratchcard for a chance to win credits (1m cooldown)

## Economy Channel Restriction

All economy commands (except owner commands) can only be used in the configured economy channel. This is set in the config file and can be changed by the bot owner.

## Owner-Only Commands

The following commands are restricted to the bot owner (configured via `BOT_OWNER_ID`):

- `/credits add` - Add credits to any user
- `/credits remove` - Remove credits from any user
- `/credits audit` - View any user's transaction history

These commands can be used outside the economy channel.

## Database Schema

The bot uses PostgreSQL with Prisma ORM. Key models include:

- `User` - Discord user accounts
- `EconomyAccount` - Economy balances and statistics
- `InventoryItem` - User inventory
- `Item` - Shop item definitions
- `Collectible` - Collectible definitions
- `UserCollectible` - User collectibles
- `Cooldown` - Command cooldowns
- `CurrencyTransaction` - Transaction history
- `Level` - XP and level data
- `ServerConfig` - Server configuration
- `WorkHistory` - Work history

## Security Features

- Database transactions for all currency operations
- Cooldowns stored in database (survive restarts)
- Input validation on all commands
- Owner-only command restrictions
- Economy channel restrictions
- Negative balance prevention
- Race condition protection

## Project Structure

```
Lunar Guild Bot/
├── src/
│   ├── commands/
│   │   ├── economy/      # Economy commands
│   │   ├── leveling/     # Leveling commands
│   │   ├── games/        # Game commands
│   │   └── admin/        # Admin commands
│   ├── events/           # Discord event handlers
│   ├── services/
│   │   ├── economy/      # Economy services
│   │   ├── leveling/     # Leveling services
│   │   ├── inventory/    # Inventory services
│   │   └── cooldowns/    # Cooldown service
│   ├── database/         # Database client
│   ├── config/           # Configuration
│   ├── embeds/           # Embed templates
│   └── index.ts          # Bot entry point
├── prisma/
│   └── schema.prisma     # Database schema
├── .env.example          # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### Bot won't start
- Check that `.env` file exists and has correct values
- Verify Discord token is valid
- Check database connection string

### Commands not registering
- Run `npm run deploy-commands`
- Verify bot has application.commands scope
- Check bot has proper permissions

### Database errors
- Run `npm run prisma:migrate` to ensure schema is up to date
- For deployed environments, run `npm run prisma:deploy` using a direct PostgreSQL connection
- Verify PostgreSQL is running
- Check DATABASE_URL in `.env`

## License

ISC
