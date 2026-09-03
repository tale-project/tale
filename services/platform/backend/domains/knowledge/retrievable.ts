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
 *     thread's scope. A row with NEITHER binding is DENIED: the corpus
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
 * A folder filter narrows further, from the CURRENT folder of each document
 * (the corpus row's stamp is a copy that can lag a move): only a document
 * filed in that folder or beneath it admits, and an unbound file — filed
 * nowhere — never does.
 */

export interface AccessScopeArg {
  teamIds?: string[];
  projectIds?: string[];
  includeHub?: boolean;
  includeConversationScoped?: boolean;
  threadIds?: string[];
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
    // Neither binding: denied. See the note at the top of this file — the
    // corpus reads an unscoped row as org-wide, so a `return true` here is a
    // fail-open default rather than a same-org one.
    continue;
  }
  return false;
}
