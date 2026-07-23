import { useCallback, useRef, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { BlobRef } from '@/convex/lib/storage/blob_ref';

/** Mirrors `MAX_KB_REFERENCES` in convex/agents/chat_turn.ts. */
export const MAX_KB_MENTIONS = 5;

/**
 * A knowledge-base document or folder pinned to the next message via the
 * composer's `@`-mention picker. The chips (this state) are the source of
 * truth — the inserted `@Title` prose is presentational, so editing it out
 * of the text does not drop the pin (remove the chip instead).
 */
export interface KbDocumentMention {
  kind: 'document';
  documentId: Id<'documents'>;
  fileId: BlobRef;
  title: string;
  fileType: string;
  fileSize: number;
  extension?: string;
  folderPath?: string;
}

/** A folder pin — expands to its subtree's indexed files at send time. */
export interface KbFolderMention {
  kind: 'folder';
  folderId: Id<'folders'>;
  title: string;
  parentPath?: string;
}

export type KbMention = KbDocumentMention | KbFolderMention;

/** Stable dedupe/removal key across both mention kinds. */
export function kbMentionKey(mention: KbMention): string {
  return mention.kind === 'document'
    ? `doc:${mention.documentId}`
    : `folder:${mention.folderId}`;
}

export interface MentionTrigger {
  /** Text typed after the `@` (may be empty right after typing `@`). */
  query: string;
  /** Index of the `@` character in the textarea value. */
  start: number;
  /** Caret position — end of the query. */
  end: number;
}

/**
 * Caret-based `@` trigger detection: the token between the last
 * `@` (at a word boundary) and the caret, with no whitespace in between.
 * Mid-word `@` (e.g. an email address) does not trigger.
 */
export function detectMentionTrigger(
  value: string,
  caret: number,
): MentionTrigger | null {
  const beforeCaret = value.slice(0, Math.max(caret, 0));
  const match = /(^|\s)@(\S*)$/.exec(beforeCaret);
  if (!match) return null;
  const query = match[2];
  return {
    query,
    start: beforeCaret.length - query.length - 1,
    end: beforeCaret.length,
  };
}

interface UseKbMentionsResult {
  mentions: KbMention[];
  /** Adds a mention (deduped by kind-scoped id). Returns false when the
   *  per-turn cap is reached and nothing was added. */
  addMention: (mention: KbMention) => boolean;
  removeMention: (key: string) => void;
  /** Empties the list and returns the cleared mentions (send-time snapshot
   *  for failure rollback — mirrors `clearAttachments`). */
  clearMentions: () => KbMention[];
  /** Restores a previously cleared snapshot (send-failure rollback). */
  restoreMentions: (mentions: KbMention[]) => void;
}

/** Composer state for `@`-mentioned knowledge-base documents. */
export function useKbMentions(): UseKbMentionsResult {
  const [mentions, setMentions] = useState<KbMention[]>([]);
  // Synchronous source of truth alongside the render state: updated at
  // mutation time (not render time) so clearMentions can return the snapshot
  // and back-to-back adds in one tick don't read a stale list. Same pattern
  // as use-convex-file-upload's attachmentsRef.
  const mentionsRef = useRef(mentions);
  const commit = useCallback((next: KbMention[]) => {
    mentionsRef.current = next;
    setMentions(next);
  }, []);

  const addMention = useCallback(
    (mention: KbMention): boolean => {
      const current = mentionsRef.current;
      const key = kbMentionKey(mention);
      if (current.some((m) => kbMentionKey(m) === key)) {
        return true;
      }
      if (current.length >= MAX_KB_MENTIONS) return false;
      commit([...current, mention]);
      return true;
    },
    [commit],
  );

  const removeMention = useCallback(
    (key: string) => {
      commit(mentionsRef.current.filter((m) => kbMentionKey(m) !== key));
    },
    [commit],
  );

  const clearMentions = useCallback((): KbMention[] => {
    const cleared = mentionsRef.current;
    commit([]);
    return cleared;
  }, [commit]);

  const restoreMentions = useCallback(
    (restored: KbMention[]) => {
      commit(restored);
    },
    [commit],
  );

  return {
    mentions,
    addMention,
    removeMention,
    clearMentions,
    restoreMentions,
  };
}
