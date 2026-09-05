/**
 * Access vocabulary for the workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts` and the chat assistant
 * tools). One check per dispatch: the turn's user must still be an active
 * member of the session's org AND their role must grant `read` on the table
 * the tool exposes — answered by the `sandbox/workspace_access:
 * resolveWorkspaceReadAccess` handler in `domains/chat/shim.ts` from the SQL
 * membership (Tier-A today: an active member reads every subject, the
 * `disabled` role reads nothing; the per-subject role matrix ports with
 * governance).
 */

/**
 * The tables the workspace read tools expose, as role-matrix subjects — the
 * ONE list every read leg types its subject against, so a table added to
 * the matrix cannot go missing in a caller's private copy.
 *
 * `allowed: true` means only that the caller's ROLE may read the table. Some
 * subjects need a second, narrower gate this vocabulary does not own:
 * `documents` and `tasks` narrow to the caller's team/project visibility,
 * and `conversations` narrows further still to its assignment scope (a
 * conversation assigned to nobody is admin triage only). Treating `allowed:
 * true` as "read the whole org" is a leak for those three.
 */
export type AgentReadSubject =
  | 'documents'
  | 'contacts'
  | 'products'
  | 'websites'
  | 'tasks'
  | 'projects'
  | 'conversations';

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
