import type { Command } from 'commander';

import { preconditionError, usageError } from '../../utils/fail';

/** Managed runtime custody requires POSIX paths and executable permissions.
 * Keep standalone config releases available on every supported CLI platform. */
export function assertManagedPlatform(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32')
    throw preconditionError(
      'Managed deployment bundles require a POSIX host and are not supported on Windows. Run these commands on the Linux deployment host; standalone config release commands remain available on Windows.',
    );
}

/** Commander accepts parent options after a subcommand too. An unsupported
 * --dry-run or expected source pin must never be silently ignored by a child.
 * Consent and quiet are shared with the existing deploy command. */
export function assertManagedOptions(
  command: Command,
  allowed: string[],
): void {
  assertManagedPlatform();
  const supported = new Set(['yes', 'quiet', ...allowed]);
  for (const [name, value] of Object.entries(command.parent?.opts() ?? {})) {
    if (value === undefined || value === false || supported.has(name)) continue;
    const flag = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    throw usageError(`--${flag} is not supported by deploy ${command.name()}.`);
  }
}
