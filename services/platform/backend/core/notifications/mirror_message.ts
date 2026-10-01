import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { z } from 'zod';

import { readableNotificationParams } from '../../../lib/shared/notification-params';
import { interpolateTemplate } from '../../../lib/shared/utils/interpolate';

const catalogSchema = z.object({
  inbox: z.record(z.string(), z.unknown()).default({}),
  notifications: z.record(z.string(), z.unknown()).default({}),
  // The board's column names: a status change stores the status ids.
  tasks: z
    .object({ status: z.record(z.string(), z.unknown()).default({}) })
    .default({ status: {} }),
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

/** A task status's label in the locale, as the board names the column. */
function taskStatusLabel(locale: string, status: string): string | undefined {
  const label: unknown =
    catalog(locale).tasks.status[status] ??
    (locale === 'de-CH' ? catalog('de').tasks.status[status] : undefined) ??
    catalog('en').tasks.status[status];
  return typeof label === 'string' ? label : undefined;
}

/**
 * Reads the same catalogs as the bell, including non-actionable notifications,
 * and makes a personal row's params readable the way the bell does (a task
 * status id reads as its column's name).
 */
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
  return interpolateTemplate(
    template,
    namespace === 'inbox'
      ? readableNotificationParams(params, (status) =>
          taskStatusLabel(locale, status),
        )
      : (params ?? undefined),
  );
}
