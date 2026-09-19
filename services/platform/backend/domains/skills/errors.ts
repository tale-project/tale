import type { Context, Env } from 'hono';
import type { Sql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  assertTeamsAssignable,
  TeamAssignmentError,
} from '../../core/lib/audience.ts';
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
 * mistake to read about, never an outage to page on. The two 412s are the
 * failed preconditions of a conditional write: `If-None-Match` refused by
 * a bundle that exists (`SKILL_EXISTS`), `If-Match` refused by a document
 * that changed or is not there (`SKILL_STALE`).
 */
export const SKILL_ERROR_STATUS: Readonly<Record<string, CodedRefusalStatus>> =
  {
    INVALID_SKILL_SLUG: 400,
    INVALID_SKILL: 400,
    SKILL_PRIVATE_RETIRED: 400,
    SKILL_FORBIDDEN: 403,
    SKILL_EXISTS: 412,
    SKILL_STALE: 412,
    SKILL_MALFORMED: 422,
    STORAGE_NOT_OWNED: 403,
    STORAGE_NOT_FOUND: 404,
    WRITE_FAILED: 400,
    // The audience rule for a team skill's `teams` (`assertSkillTeamsAssignable`).
    TEAM_NOT_IN_ORG: 400,
    TEAM_ACCESS_DENIED: 403,
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

/**
 * The audience rule for a team skill's `teams`, as the file layer's
 * `assertTeamsAssignable` hook: every id must be one of the organization's
 * teams (`TEAM_NOT_IN_ORG`), and a non-admin may only share with teams they
 * belong to (`TEAM_ACCESS_DENIED`) — `core/lib/audience.ts`, re-thrown in
 * the `AppError` shape the skill doors answer with the statuses above.
 */
export function assertSkillTeamsAssignable(
  sql: Sql,
  viewer: { organizationId: string; role: string; teamIds: readonly string[] },
): (teamIds: string[]) => Promise<void> {
  return async (teamIds) => {
    try {
      await assertTeamsAssignable(sql, viewer, teamIds);
    } catch (error) {
      if (error instanceof TeamAssignmentError) {
        throw new AppError({
          code: error.code,
          message: error.message,
          teamIds: error.data.teamIds,
        });
      }
      throw error;
    }
  };
}
