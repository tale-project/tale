// Small helpers the harness shares.

/** A message for anything that was thrown. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error) ?? 'an unknown failure';
}

/** A value as text: strings as they are, everything else as JSON. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

/** Whether a child process has ended, by exiting or by a signal (a process a
 * signal ended keeps `exitCode` null, so that alone says it still runs). */
export function hasEnded(
  proc: Pick<Bun.Subprocess, 'exitCode' | 'signalCode'>,
): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}
