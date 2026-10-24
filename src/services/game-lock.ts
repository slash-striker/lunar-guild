import { ButtonInteraction } from 'discord.js';

const locks = new Set<string>();

export async function withGameLock(
  key: string,
  interaction: ButtonInteraction,
  action: () => Promise<void>,
): Promise<void> {
  if (locks.has(key)) {
    await interaction.reply({ content: 'Please wait for the previous action to finish.', ephemeral: true });
    return;
  }
  locks.add(key);
  try {
    await action();
  } finally {
    locks.delete(key);
  }
}
