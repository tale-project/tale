import type { Command } from 'commander';

import { usageError } from '../../utils/fail';

/** Commander accepts parent options after a subcommand too. An unsupported
 * --dry-run or expected source pin must never be silently ignored by a child.
 * Consent and quiet are shared with the existing deploy command. */
export function assertManagedOptions(
  command: Command,
  allowed: string[],
): void {
  const supported = new Set(['yes', 'quiet', ...allowed]);
  for (const [name, value] of Object.entries(command.parent?.opts() ?? {})) {
    if (value === undefined || value === false || supported.has(name)) continue;
    const flag = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    throw usageError(`--${flag} is not supported by deploy ${command.name()}.`);
  }
}
