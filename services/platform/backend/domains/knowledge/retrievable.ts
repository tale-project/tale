/**
 * The retrievability DECISION — pure, so the rule that decides what RAG may
 * surface is testable without a database.
 *
 * A corpus ref is retrievable iff lifecycle truth says the content is
 * current and alive:
 *
 *   - a document whose CURRENT `file_ref` is the ref, with an ACTIVE
 *     lifecycle (`NULL`) — trashed, expired, or any future state is dark
 *     the moment the row flips, regardless of when the physical corpus
 *     purge lands; and the ref must be CURRENT, so a replaced version
 *     (history) never answers as if it were the live document. Scope
 *     (project / hub team) applies per candidate document — a WebDAV COPY
 *     twin admits through its own scope, not its sibling's.
 *   - or a LIVE unbound file row holding the ref, admitted only inside its
 *     thread's scope — or, for an emailed attachment, inside the scope of
 *     the CONVERSATION it arrived on. That one is assignment privacy, not
 *     org membership: an unassigned inbox row is admin-triage only, so the
 *     caller supplies the conversations it may read rather than this file
 *     deriving them. A row with NEITHER binding is DENIED: the corpus
 *     stamps no project and no team for that shape, and the SQL half then
 *     reads it as an org-wide hub row, so admitting it here serves one
 *     member's file to the whole organization. 0.4 denied it too
 *     (`documentId === undefined` → `continue`).
 *
 *     This does not dark the video-link lane, which was the stated reason
 *     for the earlier same-org posture. A welcome-page paste indexes with
 *     `thread_id` NULL because no thread exists yet, and the first send
 *     stamps it (`bindStorageIdsToThread`, which updates exactly the rows
 *     with no document and no thread). Before that send there is no thread
 *     for a turn to be scoped to, so nothing can legitimately ask for it;
 *     after it, the thread branch admits it.
 *
 *     Trashed file rows (a WebDAV overwrite's strands) and refs with no row
 *     at all are never retrievable.
 *
 * An email MESSAGE ref (`msg:`, `lib/knowledge/message-ref.ts`) has no
 * document and no file row; `decideMessageRetrievable` decides it by the
 * message's conversation, on the same assignment privacy as an emailed
 * attachment — and only for a door that asked for message bodies, because a
 * body is text an outsider wrote and only a door that labels and wraps it as
 * untrusted may serve it.
 *
 * A folder filter narrows further, from the CURRENT folder of each document
 * (the corpus row's stamp is a copy that can lag a move): only a document
 * filed in that folder or beneath it admits, and an unbound file — filed
 * nowhere — never does.
 */

export interface AccessScopeArg {
  teamIds?: string[];
  /** An owner/admin — the audience rule never restricts them, so every
   * team-scoped hub document admits whatever `teamIds` lists. */
  isAdmin?: boolean;
  projectIds?: string[];
  includeHub?: boolean;
  includeConversationScoped?: boolean;
  /**
   * Whether indexed email bodies (`msg:` refs) may be admitted. Only a door
   * that labels a body as mail and wraps it as untrusted sets it — the chat
   * assistant's tools; absent, no message ref is ever admitted, whatever the
   * caller may read in the Inbox.
   */
  includeConversationMessages?: boolean;
  threadIds?: string[];
  /**
   * Conversations this caller may read, already decided by
   * `conversationAssignmentAllows` — the ONE definition of inbox visibility.
   *
   * Resolved per dispatch from the CANDIDATES' own conversations, not
   * enumerated for the caller: an admin sees every conversation, and an
   * org with a large inbox would otherwise ship a list of thousands into
   * every turn's scope.
   */
  conversationIds?: string[];
}

/** A document currently exposing the ref (`file_ref` = ref). */
export interface DocCandidate {
  lifecycleStatus: string | null;
  projectId: string | null;
  teamId: string | null;
  teamTags: string[] | null;
  /** Canonical folder path (`normalizeFolderPath` spelling); null = root. */
  folderPath: string | null;
}

/** The folder itself, or anything beneath it — never `/reports-archive`
 * for `/reports`, hence the separator in the prefix. */
function folderContains(folder: string, path: string | null): boolean {
  return path !== null && (path === folder || path.startsWith(`${folder}/`));
}

/** A file row holding the ref WITHOUT a document binding. */
export interface UnboundFileCandidate {
  lifecycleStatus: string | null;
  threadId: string | null;
  /** The conversation an emailed attachment arrived on, when the file IS
   * one. Mutually exclusive with `threadId` in practice. */
  conversationId: string | null;
}

function isActiveLifecycle(status: string | null): boolean {
  return (status ?? 'active') === 'active';
}

export function decideRetrievable(
  docs: readonly DocCandidate[],
  unboundFiles: readonly UnboundFileCandidate[],
  access: AccessScopeArg | undefined,
  /** Canonical folder path to restrict to (the folder and everything under
   * it); absent = no folder filter. */
  folder?: string,
): boolean {
  for (const doc of docs) {
    if (!isActiveLifecycle(doc.lifecycleStatus)) continue;
    if (folder !== undefined && !folderContains(folder, doc.folderPath)) {
      continue;
    }
    if (access === undefined) return true;
    if (doc.projectId !== null) {
      if ((access.projectIds ?? []).includes(doc.projectId)) return true;
      continue;
    }
    if (access.includeHub === false) continue;
    const docTeams =
      doc.teamTags && doc.teamTags.length > 0
        ? doc.teamTags
        : doc.teamId
          ? [doc.teamId]
          : [];
    if (
      docTeams.length === 0 ||
      access.isAdmin === true ||
      docTeams.some((teamId) => (access.teamIds ?? []).includes(teamId))
    ) {
      return true;
    }
  }
  // A folder is a document concept: a thread upload or a transcript row is
  // filed nowhere, so a folder-scoped search never surfaces one.
  if (folder !== undefined) return false;
  for (const file of unboundFiles) {
    if (!isActiveLifecycle(file.lifecycleStatus)) continue;
    if (file.threadId !== null) {
      if (access === undefined) return true;
      if (
        access.includeConversationScoped !== false &&
        (access.threadIds ?? []).includes(file.threadId)
      ) {
        return true;
      }
      continue;
    }
    if (file.conversationId !== null) {
      // Assignment privacy, not org membership: an unassigned inbox row is
      // admin-triage only, so the allowed set is the caller's own answer
      // from `conversationAssignmentAllows` rather than anything derived
      // here. `access === undefined` is the system caller (ingest, purge),
      // which is not a person and is not scoped.
      if (access === undefined) return true;
      if (
        access.includeConversationScoped !== false &&
        (access.conversationIds ?? []).includes(file.conversationId)
      ) {
        return true;
      }
      continue;
    }
    // Neither binding: denied. See the note at the top of this file — the
    // corpus reads an unscoped row as org-wide, so a `return true` here is a
    // fail-open default rather than a same-org one.
    continue;
  }
  return false;
}

/** The inbound email a `msg:` ref names, read with the conversation it
 * arrived on — the only scope a message has. */
export interface MessageCandidate {
  conversationId: string;
  /** The conversation's lifecycle: a message of a trashed or expired
   * conversation is dark the moment the row flips, like a trashed document,
   * whatever the purge is still doing. */
  conversationLifecycleStatus: string | null;
  /** The conversation's status. `spam` is the organization's own verdict
   * that the mail is junk — and junk an outsider wrote is not an answer. */
  conversationStatus: string | null;
}

/**
 * Whether an email message's indexed body may be served. `message` is
 * undefined when no inbound email in this organization holds the id — a
 * deleted message, a malformed ref, another tenant's id — and that denies.
 *
 * Stricter than the attachment branch in one respect: a scopeless caller
 * (`access === undefined`) is refused, not admitted. Nothing that runs
 * without a person — ingest, purge, the reconcile — reads bodies through
 * this filter (they ask `liveness.ts`), so the only effect of admitting there
 * would be a door that never opted in serving mail it does not wrap.
 */
export function decideMessageRetrievable(
  message: MessageCandidate | undefined,
  access: AccessScopeArg | undefined,
  /** Canonical folder path; a message is filed nowhere, so any folder
   * filter excludes it. */
  folder?: string,
): boolean {
  if (message === undefined || folder !== undefined) return false;
  if (access?.includeConversationMessages !== true) return false;
  if (access.includeConversationScoped === false) return false;
  if (!isActiveLifecycle(message.conversationLifecycleStatus)) return false;
  if (message.conversationStatus === 'spam') return false;
  // Assignment privacy, decided by `conversationAssignmentAllows` for the
  // caller before this runs — the set is theirs, never derived here.
  return (access.conversationIds ?? []).includes(message.conversationId);
}
