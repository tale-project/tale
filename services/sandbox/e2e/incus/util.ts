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
