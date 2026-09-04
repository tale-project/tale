import type { Context, Env } from 'hono';

import { SKILL_BUNDLE_REFUSAL_CODES } from '../../core/skills/bundle_zip.ts';
import {
  appErrorResponse,
  type CodedRefusalStatus,
} from '../../lib/app-error-response.ts';

/**
 * HTTP status for every coded refusal the skill file layer and the
 * bundle-upload lane can throw — ONE map for the app routes and the REST
 * family, so a code mapped on one door cannot 500 on the other. The zip
 * parser's refusals come straight from its own exported list: a bundle
 * missing its SKILL.md, or one that lies about its size, is the uploader's
 * mistake to read about, never an outage to page on.
 */
export const SKILL_ERROR_STATUS: Readonly<Record<string, CodedRefusalStatus>> =
  {
    INVALID_SKILL_SLUG: 400,
    INVALID_SKILL: 400,
    SKILL_PRIVATE_RETIRED: 400,
    SKILL_FORBIDDEN: 403,
    SKILL_MALFORMED: 422,
    STORAGE_NOT_OWNED: 403,
    STORAGE_NOT_FOUND: 404,
    WRITE_FAILED: 400,
    ...Object.fromEntries(
      SKILL_BUNDLE_REFUSAL_CODES.map((code) => [code, 400 as const]),
    ),
  };

/** `{ error, message }` with the mapped status; rethrows an unmapped error. */
export function skillErrorResponse<E extends Env>(
  c: Context<E>,
  error: unknown,
): Response {
  return appErrorResponse(c, error, SKILL_ERROR_STATUS);
}
