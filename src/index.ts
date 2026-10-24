import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import prisma from './database/client.ts';
import { config } from './config/index.ts';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.User, Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction],
});

// Load commands
const commands = new Map();
const commandsPath = join(process.cwd(), 'src', 'commands');

function loadCommands(dir: string) {
  const files = readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    if (file.isDirectory()) {
      loadCommands(join(dir, file.name));
    } else if (file.name.endsWith('.ts') && !file.name.endsWith('.test.ts')) {
      const commandPath = join(dir, file.name);
      import(commandPath).then((command) => {
        if (command.default && command.default.data) {
          commands.set(command.default.data.name, command.default);
          console.log(`Loaded command: ${command.default.data.name}`);
        }
      }).catch((error) => {
        console.error(`Error loading command ${file.name}:`, error);
      });
    }
  }
}

loadCommands(commandsPath);

// Load events
const eventsPath = join(process.cwd(), 'src', 'events');
const eventFiles = readdirSync(eventsPath).filter((file) => file.endsWith('.ts'));

for (const file of eventFiles) {
  const eventPath = join(eventsPath, file);
  import(eventPath).then((event) => {
    if (event.default) {
      if (event.default.once) {
        client.once(event.default.name, (...args) => event.default.execute(...args));
      } else {
        client.on(event.default.name, (...args) => event.default.execute(...args));
      }
      console.log(`Loaded event: ${event.default.name}`);
    }
  }).catch((error) => {
    console.error(`Error loading event ${file}:`, error);
  });
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login:', error);
  process.exit(1);
});

export { client, commands };
