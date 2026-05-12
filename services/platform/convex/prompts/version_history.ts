import type { Doc } from '../_generated/dataModel';
import { MAX_PROMPT_VERSION_HISTORY } from './constants';

export type VersionHistoryEntry = {
  version: number;
  content: string;
  publishedAt: number;
  publishedBy: string;
  /**
   * Vestigial — kept on the type so older rows that still have it round-trip
   * cleanly through the validator. New writes (createPrompt, updatePrompt,
   * restoreFromVersion) no longer set this field.
   */
  publishNote?: string;
};

/**
 * Prepend `entry` to `prevHistory`, capping the result at
 * MAX_PROMPT_VERSION_HISTORY (FIFO drop of the oldest). Pure function — no
 * I/O, safe to unit test. `versionHistory[0]` is always the current version
 * of a prompt, so this is called on every save / restore.
 */
export function prependVersionEntry(
  prevHistory: VersionHistoryEntry[] | undefined,
  entry: VersionHistoryEntry,
  promptId?: string,
): VersionHistoryEntry[] {
  const next = [entry, ...(prevHistory ?? [])];
  if (next.length > MAX_PROMPT_VERSION_HISTORY) {
    console.warn(
      `[prompts] versionHistory truncated for ${promptId ?? 'prompt'}: dropping ${
        next.length - MAX_PROMPT_VERSION_HISTORY
      } oldest entries`,
    );
    return next.slice(0, MAX_PROMPT_VERSION_HISTORY);
  }
  return next;
}

export interface BuildVersionEntryArgs {
  existing: Doc<'promptTemplates'>;
  content: string;
  publishedBy: string;
}

/**
 * Compose the next version entry + capped history for a publish-style write.
 * Centralizes the `existing.version + 1`, `Date.now()`, and FIFO-cap logic so
 * `updatePrompt` and `restoreFromVersion` stay in lockstep.
 *
 * Legacy JIT-seed: if `existing` predates this feature (no `version` /
 * `versionHistory`), its current content is captured as v1 before the new
 * entry is recorded as v2 — otherwise the original pre-versioning content
 * would be silently overwritten on first edit and lost from history.
 */
export function buildNextVersionEntry({
  existing,
  content,
  publishedBy,
}: BuildVersionEntryArgs): {
  entry: VersionHistoryEntry;
  newVersion: number;
  nextHistory: VersionHistoryEntry[];
} {
  const isLegacy = existing.version === undefined;
  const baseHistory: VersionHistoryEntry[] = isLegacy
    ? [
        {
          version: 1,
          content: existing.content,
          publishedAt: existing._creationTime,
          publishedBy: existing.createdBy,
        },
      ]
    : (existing.versionHistory ?? []);
  const baseVersion = isLegacy ? 1 : (existing.version ?? 0);
  const newVersion = baseVersion + 1;
  const entry: VersionHistoryEntry = {
    version: newVersion,
    content,
    publishedAt: Date.now(),
    publishedBy,
  };
  const nextHistory = prependVersionEntry(baseHistory, entry, existing._id);
  return { entry, newVersion, nextHistory };
}
