import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type { AuthenticatedUser } from '../lib/rls/types';

/**
 * Shared access + lookup helpers for the customer support portal.
 *
 * Access model: a support case is ORG-scoped, so "designated support staff" is
 * resolved as "an active member of the organization" (the same gate every
 * org-scoped surface uses via {@link getOrganizationMember}). A finer-grained
 * support-staff role can layer on top later without changing call sites — this
 * is the single chokepoint every read/write goes through.
 */

/**
 * Length caps for free-text inputs, mirroring the sibling `tasks` module
 * (`TASK_TITLE_MAX`/`TASK_DESCRIPTION_MAX`/`TASK_COMMENT_MAX`). Cases can capture
 * customer-originated content (`requesterEmail`/`requesterName`, inbound
 * subject/body), so bounding every write keeps storage and the query budget off
 * the unbounded-string cliff the sibling modules already guard against.
 */
export const SUPPORT_CASE_SUBJECT_MAX = 200;
export const SUPPORT_CASE_DESCRIPTION_MAX = 20_000;
export const SUPPORT_CASE_COMMENT_MAX = 10_000;
export const SUPPORT_CASE_REQUESTER_EMAIL_MAX = 320;
export const SUPPORT_CASE_REQUESTER_NAME_MAX = 200;

/**
 * Trim + bound-check a required case subject; throws on empty or over-length
 * (mirrors `tasks` `validateTitle`).
 */
export function validateSubject(raw: string): string {
  const subject = raw.trim();
  if (!subject) {
    throw new ConvexError({
      code: 'invalid_subject',
      message: 'A case subject is required.',
    });
  }
  if (subject.length > SUPPORT_CASE_SUBJECT_MAX) {
    throw new ConvexError({
      code: 'subject_too_long',
      message: `A case subject cannot exceed ${SUPPORT_CASE_SUBJECT_MAX} characters.`,
    });
  }
  return subject;
}

/**
 * Trim + bound-check a required comment / note body; throws on empty or
 * over-length (mirrors `tasks` `TASK_COMMENT_MAX`).
 */
export function validateCommentBody(raw: string): string {
  const body = raw.trim();
  if (!body) {
    throw new ConvexError({
      code: 'empty_comment',
      message: 'A comment cannot be empty.',
    });
  }
  if (body.length > SUPPORT_CASE_COMMENT_MAX) {
    throw new ConvexError({
      code: 'comment_too_long',
      message: `A comment cannot exceed ${SUPPORT_CASE_COMMENT_MAX} characters.`,
    });
  }
  return body;
}

/**
 * Bound-check then trim an OPTIONAL free-text field. The length cap is checked
 * before trimming (so padding can't smuggle past the limit); returns `undefined`
 * when the field is omitted or blank, mirroring `tasks` `validateDescription`.
 */
export function validateOptionalText(
  raw: string | undefined,
  max: number,
  code: string,
): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.length > max) {
    throw new ConvexError({
      code,
      message: `Value cannot exceed ${max} characters.`,
    });
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Authorize a READ against the support portal. Returns the authenticated user
 * on success, or `null` when the caller is unauthenticated or not an org member
 * — read handlers translate `null` into an empty result rather than throwing.
 */
export async function authorizeSupportRead(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<AuthenticatedUser | null> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) return null;
  try {
    await getOrganizationMember(ctx, organizationId, authUser);
  } catch {
    return null;
  }
  return authUser;
}

/**
 * Authorize a WRITE against the support portal: the caller must be an
 * authenticated, active member of the organization. Throws `ConvexError` with a
 * stable `code` (mirroring the tasks write paths) on failure.
 */
export async function authorizeSupportWrite(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AuthenticatedUser> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new ConvexError({ code: 'forbidden' });
  // getOrganizationMember throws UnauthorizedError for non-members / disabled
  // accounts; let it propagate.
  await getOrganizationMember(ctx, organizationId, authUser);
  return authUser;
}

/**
 * Load a case scoped to its organization. Returns `null` when the case does not
 * exist or belongs to another org (so a leaked id can't cross the org boundary)
 * — callers decide whether that is an empty read or a thrown write error.
 */
export async function loadCaseInOrg(
  ctx: QueryCtx | MutationCtx,
  caseId: Id<'supportCases'>,
  organizationId: string,
): Promise<Doc<'supportCases'> | null> {
  const supportCase = await ctx.db.get(caseId);
  if (!supportCase) return null;
  if (supportCase.organizationId !== organizationId) return null;
  return supportCase;
}

/**
 * Load a case for a write, throwing `not_found` when it is missing or
 * cross-org. Keeps every mutation's "fetch + authorize the target" step to one
 * line.
 */
export async function requireCaseInOrg(
  ctx: MutationCtx,
  caseId: Id<'supportCases'>,
  organizationId: string,
): Promise<Doc<'supportCases'>> {
  const supportCase = await loadCaseInOrg(ctx, caseId, organizationId);
  if (!supportCase) {
    throw new ConvexError({ code: 'not_found', message: 'Case not found.' });
  }
  return supportCase;
}

/**
 * Append a row to the case activity timeline. Centralised so every mutation
 * records history the same way (creation, status, escalation, assignee, …).
 */
export async function recordCaseActivity(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    caseId: Id<'supportCases'>;
    actorType: 'user' | 'agent';
    actorId: string;
    action: string;
    fromValue?: string;
    toValue?: string;
    at: number;
  },
): Promise<void> {
  await ctx.db.insert('supportCaseActivity', {
    organizationId: args.organizationId,
    caseId: args.caseId,
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    fromValue: args.fromValue,
    toValue: args.toValue,
    createdAt: args.at,
  });
}
