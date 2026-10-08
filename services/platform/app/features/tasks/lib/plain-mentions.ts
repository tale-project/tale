import {
  type MentionActorEntry,
  type MentionHandleIndex,
  type MentionKind,
  mentionRefKey,
} from '@/lib/shared/mention-handles';

/** An agent id: what an older text typed after `@` for an agent whose name
 * made no handle. Nobody answering to it, it names an agent that was
 * deleted. */
const AGENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a task text knows about the typed `@handle`s in it. */
export interface PlainMentionScope {
  /** Whom the text named when it was saved (a comment's resolved mentions):
   * a typed handle names one of them, the one it named then, or nobody.
   * Undefined for a text that keeps no such record (a description). */
  saved?: ReadonlyArray<{ type: MentionKind; id: string }>;
  /** False for a text whose `@names` are another system's people (a task
   * mirrored from GitHub or GlitchTip): no typed handle names anyone. */
  plain?: boolean;
}

export type PlainMention =
  | { type: 'actor'; entry: MentionActorEntry }
  | { type: 'deletedAgent' };

/**
 * Whom a typed `@handle` in a task text names, for the reader: the field
 * that edits the text and the view that shows it read it alike. A handle
 * that names nobody stays the words it was, except an agent's id, which
 * reads as a deleted agent rather than as an id.
 */
export function plainMentionReader(
  index: MentionHandleIndex,
  scope: PlainMentionScope,
): (handle: string) => PlainMention | null {
  if (scope.plain === false) return () => null;
  const saved =
    scope.saved === undefined
      ? undefined
      : new Set(
          scope.saved.map((mention) =>
            mentionRefKey({ kind: mention.type, id: mention.id }),
          ),
        );
  return (handle) => {
    const entry = index.resolve(handle, saved);
    if (
      entry !== null &&
      (saved === undefined || saved.has(mentionRefKey(entry)))
    ) {
      return { type: 'actor', entry };
    }
    if (entry === null && AGENT_ID_RE.test(handle)) {
      return { type: 'deletedAgent' };
    }
    return null;
  };
}
