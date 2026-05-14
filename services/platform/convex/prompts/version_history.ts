import type { Doc } from '../_generated/dataModel';
import { MAX_PROMPT_VERSION_HISTORY } from './constants';

type PromptScope = 'global' | 'team' | 'personal';

export type PromptVersionMetadata = {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  scope: PromptScope;
  teamId?: string;
};

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
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  scope: PromptScope;
  teamId?: string;
};

/**
 * Find the versionHistory entry the user is asking to restore. For pre-
 * versioning rows (`versionHistory` empty), `targetVersion === 1` is the
 * synthesized legacy v1 — the same shape `getPromptHistory` displays —
 * so the dialog and the mutation stay in lockstep.
 */
export function resolveRestoreTarget(
  existing: Doc<'promptTemplates'>,
  targetVersion: number,
): VersionHistoryEntry | undefined {
  const entries = existing.versionHistory ?? [];
  const direct = entries.find((h) => h.version === targetVersion);
  if (direct) return direct;
  if (entries.length === 0 && targetVersion === 1) {
    return synthesizeLegacyV1Entry(existing);
  }
  return undefined;
}

/**
 * Build a v1 entry from a prompt's current row state. Used in two places:
 * `getPromptHistory` (display-only, when versionHistory is empty) and
 * `resolveRestoreTarget` (the actual restore target when a user rolls back
 * a pre-versioning row to v1). Both paths must read the same shape or the
 * dialog and the mutation drift apart.
 */
export function synthesizeLegacyV1Entry(
  prompt: Doc<'promptTemplates'>,
): VersionHistoryEntry {
  return {
    version: 1,
    content: prompt.content,
    publishedAt: prompt._creationTime,
    publishedBy: prompt.createdBy,
    title: prompt.title,
    description: prompt.description,
    category: prompt.category,
    tags: prompt.tags,
    scope: prompt.scope,
    teamId: prompt.teamId,
  };
}

/**
 * Prepend `entry` to `prevHistory`, capping the result at
 * MAX_PROMPT_VERSION_HISTORY (FIFO drop of the oldest). Pure function — no
 * I/O, safe to unit test. `versionHistory[0]` is always the current version
 * of a prompt, so this is called on every save / restore.
 *
 * Returns `droppedVersions` (the version numbers of evicted entries) so the
 * caller can emit a `prompt_template.history_truncated` audit event;
 * silent FIFO eviction would otherwise hide history loss from audit consumers.
 */
export function prependVersionEntry(
  prevHistory: VersionHistoryEntry[] | undefined,
  entry: VersionHistoryEntry,
  promptId?: string,
): { history: VersionHistoryEntry[]; droppedVersions: number[] } {
  const next = [entry, ...(prevHistory ?? [])];
  if (next.length > MAX_PROMPT_VERSION_HISTORY) {
    const dropped = next.slice(MAX_PROMPT_VERSION_HISTORY);
    const droppedVersions = dropped.map((e) => e.version);
    console.warn(
      `[prompts] versionHistory truncated for ${promptId ?? 'prompt'}: dropping ${
        droppedVersions.length
      } oldest entries (v${droppedVersions.join(', v')})`,
    );
    return {
      history: next.slice(0, MAX_PROMPT_VERSION_HISTORY),
      droppedVersions,
    };
  }
  return { history: next, droppedVersions: [] };
}

interface BuildVersionEntryArgs {
  existing: Doc<'promptTemplates'>;
  content: string;
  publishedBy: string;
  metadata: PromptVersionMetadata;
}

/**
 * Compose the next version entry + capped history for a publish-style write.
 * Centralizes the `existing.version + 1`, `Date.now()`, and FIFO-cap logic so
 * `updatePrompt` and `restoreFromVersion` stay in lockstep.
 *
 * Legacy JIT-seed: if `existing` predates this feature (no `version` /
 * `versionHistory`), its current row state — content AND metadata — is
 * captured as v1 before the new entry is recorded as v2. Otherwise the
 * original pre-versioning content would be silently overwritten on first
 * edit and lost from history.
 *
 * `droppedVersions` propagates the FIFO eviction list from
 * `prependVersionEntry` so the caller can audit history truncation.
 */
export function buildNextVersionEntry({
  existing,
  content,
  publishedBy,
  metadata,
}: BuildVersionEntryArgs): {
  newVersion: number;
  nextHistory: VersionHistoryEntry[];
  droppedVersions: number[];
} {
  const baseHistory: VersionHistoryEntry[] =
    existing.version === undefined
      ? [synthesizeLegacyV1Entry(existing)]
      : (existing.versionHistory ?? []);
  const baseVersion = existing.version ?? 1;
  const newVersion = baseVersion + 1;
  const entry: VersionHistoryEntry = {
    version: newVersion,
    content,
    publishedAt: Date.now(),
    publishedBy,
    title: metadata.title,
    description: metadata.description,
    category: metadata.category,
    tags: metadata.tags,
    scope: metadata.scope,
    teamId: metadata.teamId,
  };
  const { history: nextHistory, droppedVersions } = prependVersionEntry(
    baseHistory,
    entry,
    existing._id,
  );
  return { newVersion, nextHistory, droppedVersions };
}

/**
 * True if `next` differs from `prev` on any versioned metadata field. Used
 * by updatePrompt to decide whether a metadata-only edit should bump the
 * version (instead of just patching the row in place).
 */
export function metadataDiffers(
  prev: Pick<
    Doc<'promptTemplates'>,
    'title' | 'description' | 'category' | 'tags' | 'scope' | 'teamId'
  >,
  next: PromptVersionMetadata,
): boolean {
  if (prev.title !== next.title) return true;
  if ((prev.description ?? undefined) !== (next.description ?? undefined)) {
    return true;
  }
  if ((prev.category ?? undefined) !== (next.category ?? undefined)) {
    return true;
  }
  if (!tagsEqual(prev.tags, next.tags)) return true;
  if (prev.scope !== next.scope) return true;
  if ((prev.teamId ?? undefined) !== (next.teamId ?? undefined)) return true;
  return false;
}

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}
