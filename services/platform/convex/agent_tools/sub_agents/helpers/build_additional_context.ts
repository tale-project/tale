/**
 * Builds additionalContext record for sub-agent calls.
 * Maps tool args to snake_case context keys.
 */

export type FieldMapping<T> = {
  [K in keyof T]?: string;
};

export function buildAdditionalContext<T extends Record<string, unknown>>(
  args: T,
  mapping: FieldMapping<T>,
): Record<string, string> | undefined {
  const context: Record<string, string> = {};

  for (const [argKey, contextKey] of Object.entries(mapping)) {
    const value = args[argKey as keyof T];
    if (value !== undefined && value !== null && contextKey) {
      context[contextKey] = String(value);
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}
