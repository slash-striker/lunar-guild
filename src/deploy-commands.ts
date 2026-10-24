import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const commands: any[] = [];

const commandsPath = join(process.cwd(), 'src', 'commands');

async function loadCommands(dir: string): Promise<void> {
  const files = readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = join(dir, file.name);

    if (file.isDirectory()) {
      await loadCommands(fullPath);
      continue;
    }

    if (!file.name.endsWith('.ts')) {
      continue;
    }

    if (file.name.endsWith('.test.ts')) {
      continue;
    }

    try {
      const commandModule = await import(pathToFileURL(fullPath).href);

      const command = commandModule.default;

      if (!command?.data?.toJSON) {
        console.log(`Skipping ${file.name}: no command data`);
        continue;
      }

      const commandData = command.data.toJSON();

      commands.push(commandData);

      console.log(`Found command: ${commandData.name}`);
    } catch (error) {
      console.error(`Failed to load command ${file.name}:`);
      console.error(error);
    }
  }
}

async function main() {
  console.log('================================');
  console.log('LUNAR GUILD COMMAND DEPLOYMENT');
  console.log('================================');

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token) {
    throw new Error('DISCORD_TOKEN is missing from .env');
  }

  if (!clientId) {
    throw new Error('DISCORD_CLIENT_ID is missing from .env');
  }

  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID is missing from .env');
  }

  console.log(`Client ID: ${clientId}`);
  console.log(`Guild ID: ${guildId}`);
  console.log('');

  console.log('Loading commands...');

  await loadCommands(commandsPath);

  console.log('');
  console.log(`Found ${commands.length} commands.`);
  console.log('');

  if (commands.length === 0) {
    throw new Error('No commands were found!');
  }

  console.log('Commands being deployed:');

  for (const command of commands) {
    console.log(`  /${command.name}`);
  }

  console.log('');
  console.log('Sending commands to Discord...');

  const rest = new REST({ version: '10' }).setToken(token);

  const result = await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    {
      body: commands,
    },
  );

  console.log('');
  console.log('================================');
  console.log('COMMAND DEPLOYMENT SUCCESSFUL');
  console.log('================================');
  console.log(`Discord registered ${(result as any[]).length} commands.`);
  console.log('');
}

main().catch((error) => {
  console.error('');
  console.error('================================');
  console.error('COMMAND DEPLOYMENT FAILED');
  console.error('================================');
  console.error(error);
  process.exit(1);
});
