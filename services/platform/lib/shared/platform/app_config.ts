/**
 * Per-install app config completeness — whether an operator has supplied the
 * required `requires.config` values so the "Configuration needed" prompt can hide.
 */

export interface AppConfigFieldShape {
  key: string;
  type: 'string' | 'number' | 'boolean';
  /** When true, an empty stored value still counts as configured. */
  optional?: boolean;
}

/** True when every non-optional declared field has a non-empty scalar value. */
export function isAppConfigComplete(
  fields: readonly AppConfigFieldShape[],
  config: Record<string, unknown>,
): boolean {
  return fields.every((f) => {
    if (f.type === 'boolean' || f.optional) return true;
    const v = config[f.key];
    return (typeof v === 'string' || typeof v === 'number') && String(v) !== '';
  });
}

/**
 * Overlay catalog `optional` hints onto an installed app's config fields so
 * readiness gates pick up manifest changes without a reinstall.
 */
export function mergeAppConfigFields<T extends AppConfigFieldShape>(
  installed: readonly T[],
  catalog?: readonly AppConfigFieldShape[],
): T[] {
  const optionalByKey = new Map(
    (catalog ?? []).map((f) => [f.key, f.optional] as const),
  );
  return installed.map((f) => ({
    ...f,
    ...(f.optional === undefined &&
      optionalByKey.has(f.key) && { optional: optionalByKey.get(f.key) }),
  }));
}
