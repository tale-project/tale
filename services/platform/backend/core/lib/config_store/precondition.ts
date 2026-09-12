import type { FileReadResult } from '../file_io';

export class ConfigurationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 502 = 409,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Called only while the native writer holds its domain/row transaction. */
export function assertExpectedHash(
  actual: string | null,
  expected: string | null | undefined,
): void {
  if (expected !== undefined && actual !== expected) {
    throw new ConfigurationError(
      'CONFIG_VERSION_CONFLICT',
      'Configuration changed since it was reviewed. Read the current value and plan again.',
    );
  }
}

/** Never turn an unreadable or malformed preimage into create permission. */
export function configSnapshot<T>(result: FileReadResult<T>): {
  config: T | null;
  hash: string | null;
} {
  if (result.ok) return { config: result.data, hash: result.hash };
  if (result.error === 'not_found') return { config: null, hash: null };
  throw new ConfigurationError(
    'CONFIG_UNREADABLE',
    'The current configuration is unreadable. Repair it before applying changes.',
  );
}
