/**
 * Query-side access resolution for the workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts` — an action, so the
 * membership read has to cross into a query). One check per dispatch: the
 * turn's user must still be an active member of the session's org AND their
 * role must grant `read` on the table the tool exposes — the same policy the
 * user-side `queryWithRLS` surfaces enforce, via the same primitives
 * (`lib/rls/helpers/agent_read_access.ts`).
 */

import { v } from 'convex/values';

/**
 * The wire spelling of {@link AgentReadSubject}. Convex needs literal
 * validators, so this list cannot be generated from the const array — a test
 * asserts the two agree instead, because a subject present in one and missing
 * from the other is an argument-validation error at dispatch, not a type error
 * at build.
 */
export const agentReadSubjectValidator = v.union(
  v.literal('documents'),
  v.literal('contacts'),
  v.literal('products'),
  v.literal('websites'),
  v.literal('tasks'),
  v.literal('projects'),
  v.literal('conversations'),
);

/**
 * The subjects the SESSION-BINDING gate arbitrates — a strict subset of
 * {@link AgentReadSubject}, and a different question.
 *
 * `resolveWorkspaceReadAccess` asks "may this role read this table"; this asks
 * "may this run act on this subject, given the project its automation is bound
 * to". `projects` and `conversations` are absent because nothing dispatches a
 * session-bound action on them, and `tasks` is present here yet answered by
 * binding rather than by the role matrix.
 */
export const SESSION_ACTION_SUBJECTS = [
  'tasks',
  'documents',
  'contacts',
  'products',
  'websites',
] as const;

export type SessionActionSubject = (typeof SESSION_ACTION_SUBJECTS)[number];
/** One dispatch's resolved authority over a first-party domain. */
export type WorkspaceActionContext =
  | {
      allowed: true;
      /** Task/document-domain attribution for this session's writes. */
      actorId: string;
      scope:
        | { kind: 'project'; projectId: string }
        | { kind: 'org'; allowedProjectIds?: string[] };
    }
  | {
      allowed: false;
      reason: 'no_access_context' | 'not_a_member' | 'read_denied';
    };
