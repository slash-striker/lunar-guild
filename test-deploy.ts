import 'dotenv/config';
import { REST, Routes } from 'discord.js';

console.log('=== DISCORD COMMAND DEPLOY TEST ===');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

console.log('Token exists:', !!token);
console.log('Client ID:', clientId);
console.log('Guild ID:', guildId);

if (!token) {
  throw new Error('DISCORD_TOKEN is missing');
}

if (!clientId) {
  throw new Error('DISCORD_CLIENT_ID is missing');
}

if (!guildId) {
  throw new Error('DISCORD_GUILD_ID is missing');
}

const rest = new REST({ version: '10' }).setToken(token);

const commands = [
  {
    name: 'test',
    description: 'Test command',
  },
];

console.log('Sending test command to Discord...');

try {
  const result = await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    {
      body: commands,
    },
  );

  console.log('SUCCESS!');
  console.log('Discord returned:', result);
  console.log(`Registered ${(result as any[]).length} command(s).`);
} catch (error) {
  console.error('DEPLOYMENT FAILED:');
  console.error(error);
  process.exit(1);
}
