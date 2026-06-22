import type { z } from 'zod';

import { isRecord } from '@/lib/utils/type-utils';

/**
 * Builds the `(raw: unknown) => T` parser shared by the governance policy
 * editors. Each editor previously inlined the same body: coerce a non-object to
 * `{}`, validate the stored `policy.config` against the policy's Zod schema, and
 * fall back to a default when it's missing or malformed.
 *
 * `makeFallback` is a factory (`() => T`, like `useState`'s lazy initializer) so
 * callers whose default spreads arrays/objects (login backoff schedule,
 * two-factor defaults, …) get a fresh instance per call rather than sharing one
 * mutable object across every parse.
 */
export function createConfigParser<S extends z.ZodTypeAny>(
  schema: S,
  makeFallback: () => z.infer<S>,
): (raw: unknown) => z.infer<S> {
  return (raw: unknown) => {
    const obj = isRecord(raw) ? raw : {};
    const result = schema.safeParse(obj);
    return result.success ? result.data : makeFallback();
  };
}
