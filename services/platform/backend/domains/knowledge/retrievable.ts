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
 *   - or a LIVE unbound file row holding the ref: thread-bound rows admit
 *     only inside their thread's scope; rows with neither binding keep the
 *     0.4 same-org posture DELIBERATELY — video-link transcripts index
 *     without a document, so a blanket quarantine would dark a legitimate
 *     lane. Trashed file rows (a WebDAV overwrite's strands) and refs with
 *     no row at all are never retrievable.
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
): boolean {
  for (const doc of docs) {
    if (!isActiveLifecycle(doc.lifecycleStatus)) continue;
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
    return true;
  }
  return false;
}
