import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { z } from 'zod';

import { interpolateTemplate } from '../../../lib/shared/utils/interpolate';

const catalogSchema = z.object({
  inbox: z.record(z.string(), z.unknown()).default({}),
  notifications: z.record(z.string(), z.unknown()).default({}),
});
const catalogs = new Map<string, z.infer<typeof catalogSchema>>();

function catalog(locale: string) {
  const supported = ['en', 'de', 'fr', 'de-CH'].includes(locale)
    ? locale
    : 'en';
  let loaded = catalogs.get(supported);
  if (!loaded) {
    loaded = catalogSchema.parse(
      parse(
        readFileSync(
          new URL(`../../../messages/${supported}.yml`, import.meta.url),
          'utf8',
        ),
      ),
    );
    catalogs.set(supported, loaded);
  }
  return loaded;
}

/** Reads the same catalogs as the bell, including non-actionable notifications. */
export function mirrorMessage(
  namespace: 'inbox' | 'notifications',
  key: string,
  params: Record<string, unknown> | null,
  locale: string,
): string {
  const bare = key.replace(new RegExp(`^${namespace}[.:]`), '');
  const local: unknown =
    catalog(locale)[namespace][bare] ??
    (locale === 'de-CH' ? catalog('de')[namespace][bare] : undefined);
  const fallback: unknown = catalog('en')[namespace][bare];
  const template =
    typeof local === 'string'
      ? local
      : typeof fallback === 'string'
        ? fallback
        : bare;
  return interpolateTemplate(template, params ?? undefined);
}
