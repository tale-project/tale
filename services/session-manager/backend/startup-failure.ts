// What a person is told when the server cannot start for a reason of their
// own making (a port that is taken, a data directory that cannot be written, a
// database another program made), instead of the runtime's stack trace.

import { isRecord } from '../lib/is-record.ts';
import { ConfigError, type Config } from './config.ts';
import { StoreOpenError } from './db/store.ts';

/** What the system answers when a directory or a file cannot be made or opened. */
const FILE_CODES: ReadonlySet<string> = new Set([
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOTDIR',
  'EEXIST',
  'ENOENT',
  'SQLITE_CANTOPEN',
]);

function textOf(error: unknown, key: string): string | null {
  if (!isRecord(error)) return null;
  const value = error[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The sentence that tells the person what to change, or `null` when the
 * failure is not one a person can fix (a bug: it is thrown with its stack).
 */
export function explainStartupFailure(
  error: unknown,
  config: Pick<Config, 'port' | 'dataDir'>,
): string | null {
  if (error instanceof StoreOpenError || error instanceof ConfigError) {
    return error.message;
  }
  const code = textOf(error, 'code');
  if (code === 'EADDRINUSE') {
    return `Port ${config.port} is already in use. Stop the program that uses it, or set PORT to another port.`;
  }
  if (code === 'EACCES' && textOf(error, 'syscall') === 'listen') {
    return `Port ${config.port} cannot be used by this user. Set PORT to another port.`;
  }
  if (code !== null && FILE_CODES.has(code)) {
    const reason = error instanceof Error ? error.message : code;
    return `The data directory ${config.dataDir} cannot be used (${reason}). Set SESSION_MANAGER_DATA_DIR to a directory that this user can write to.`;
  }
  return null;
}
