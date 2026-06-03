/**
 * Strip a provider qualifier prefix — everything up to and including the first
 * colon — from a model id, e.g. `openai:gpt-4o` -> `gpt-4o`. Ids without a
 * colon are returned unchanged.
 */
export function stripQualifier(s: string): string {
  const idx = s.indexOf(':');
  return idx === -1 ? s : s.slice(idx + 1);
}
