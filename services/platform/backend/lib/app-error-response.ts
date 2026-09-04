import type { Context, Env } from 'hono';

import { AppError } from '../../lib/shared/errors/app-error';

/**
 * The statuses a coded refusal may map onto. Every entry is a 4xx: the whole
 * point of a code→status map is that a refusal the domain layer explains
 * never reads as a server outage.
 */
export type CodedRefusalStatus = 400 | 403 | 404 | 409 | 422;

/** The `{ code, message }` an `AppError` carries, or `null` for anything else. */
export function codedAppError(
  error: unknown,
): { code: string; message: string } | null {
  if (!(error instanceof AppError)) return null;
  const data: unknown = error.data;
  if (data === null || typeof data !== 'object' || !('code' in data)) {
    return null;
  }
  const code: unknown = Reflect.get(data, 'code');
  if (typeof code !== 'string') return null;
  const message: unknown = Reflect.get(data, 'message');
  return { code, message: typeof message === 'string' ? message : code };
}

/**
 * Answer a coded `AppError` with the status its code maps to, as
 * `{ error: <code>, message }` — the shape every file-layer door (agents,
 * skills, app and REST alike) speaks. Anything else — an unmapped code, a
 * plain Error — is rethrown for the app-level handler, which reports it as
 * the defect it is. A code the domain layer can throw but the map does not
 * carry therefore surfaces as a 500: keep each family's map in ONE module
 * and build it from the layer's own exported code lists where there are any.
 */
export function appErrorResponse<E extends Env>(
  c: Context<E>,
  error: unknown,
  statusByCode: Readonly<Record<string, CodedRefusalStatus>>,
): Response {
  const coded = codedAppError(error);
  const status = coded === null ? undefined : statusByCode[coded.code];
  if (coded === null || status === undefined) throw error;
  return c.json({ error: coded.code, message: coded.message }, status);
}
