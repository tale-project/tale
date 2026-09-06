/**
 * Query-side access resolution for the workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts` — an action, so the
 * membership read has to cross into a query). One check per dispatch: the
 * turn's user must still be an active member of the session's org AND their
 * role must grant `read` on the table the tool exposes — the same policy the
 * user-side `queryWithRLS` surfaces enforce, via the same primitives
 * (`lib/rls/helpers/agent_read_access.ts`).
 */

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
