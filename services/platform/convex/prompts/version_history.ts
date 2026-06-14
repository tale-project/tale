import type { Doc, Id } from '../_generated/dataModel';
import { MAX_PROMPT_VERSION_HISTORY } from './constants';

type PromptScope = 'global' | 'team' | 'personal';

export type PromptVersionMetadata = {
  title: string;
  description?: string;
  /**
   * Free-form category string. Coexists with `categoryId`: default/seeded
   * prompts carry only the string (the catalog files set `category`, never
   * an id), and any write lazy-resolves it to a `promptCategories` row —
   * see `promptTemplatesTable.category`. Snapshots carry whichever the row
   * had at that version so Restore re-applies the same representation.
   */
  category?: string;
  /** See `promptTemplatesTable.categoryId`. */
  categoryId?: Id<'promptCategories'>;
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
  categoryId?: Id<'promptCategories'>;
  tags?: string[];
  scope: PromptScope;
  teamId?: string;
};

/**
 * Find the versionHistory entry the user is asking to restore. Every prompt
 * created on this codebase is born with a populated `versionHistory`; the
 * empty-history branch is a defensive normalizer for the optional schema
 * field (`versionHistory` is `v.optional`). When it is empty,
 * `targetVersion === 1` resolves to a v1 synthesized from current row state —
 * the same shape `getPromptHistory` displays — so the dialog and the mutation
 * stay in lockstep.
 */
export function resolveRestoreTarget(
  existing: Doc<'promptTemplates'>,
  targetVersion: number,
): VersionHistoryEntry | undefined {
  const entries = existing.versionHistory ?? [];
  const direct = entries.find((h) => h.version === targetVersion);
  if (direct) return direct;
  if (entries.length === 0 && targetVersion === 1) {
    return synthesizeV1Entry(existing);
  }
  return undefined;
}

/**
 * Build a v1 entry from a prompt's current row state. Used in two places:
 * `getPromptHistory` (display-only, when versionHistory is empty) and
 * `resolveRestoreTarget` (the restore target when rolling a history-less row
 * back to v1). Both paths must read the same shape or the dialog and the
 * mutation drift apart. Because `version`/`versionHistory` are optional on
 * the schema, this also backstops any row that somehow lacks inline history.
 */
export function synthesizeV1Entry(
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
    categoryId: prompt.categoryId,
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
  // Kept in the signature for call-site compatibility; the `console.warn`
  // that previously consumed it was redundant with the
  // `prompt_template.history_truncated` audit row the caller already emits.
  _promptId?: string,
): { history: VersionHistoryEntry[]; droppedVersions: number[] } {
  const next = [entry, ...(prevHistory ?? [])];
  if (next.length > MAX_PROMPT_VERSION_HISTORY) {
    const dropped = next.slice(MAX_PROMPT_VERSION_HISTORY);
    const droppedVersions = dropped.map((e) => e.version);
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
 * JIT v1 seed: if `existing` has no inline `version` / `versionHistory`
 * (defensive — every prompt created here is born with both, but the schema
 * fields are optional), its current row state — content AND metadata — is
 * captured as v1 before the new entry is recorded as v2. Otherwise the
 * original content would be silently overwritten on first edit and lost
 * from history.
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
  // Prefer any existing history (handles partial-migration rows where
  // `version` is undefined but `versionHistory` already has entries — the
  // earlier `version === undefined` gate would have silently overwritten
  // them).
  const baseHistory: VersionHistoryEntry[] =
    existing.versionHistory && existing.versionHistory.length > 0
      ? existing.versionHistory
      : existing.version === undefined
        ? [synthesizeV1Entry(existing)]
        : [];
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
    categoryId: metadata.categoryId,
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
 * Compose the v1 entry written at create time. Pairs with
 * `buildNextVersionEntry` so the v1 / v2+ entry shape stays in lockstep — a
 * new `VersionHistoryEntry` field added in only one place would otherwise
 * make v1 rows fail the validator on subsequent reads.
 */
export function buildInitialVersionEntry(args: {
  content: string;
  publishedBy: string;
  publishedAt: number;
  metadata: PromptVersionMetadata;
}): VersionHistoryEntry {
  return {
    version: 1,
    content: args.content,
    publishedAt: args.publishedAt,
    publishedBy: args.publishedBy,
    title: args.metadata.title,
    description: args.metadata.description,
    category: args.metadata.category,
    categoryId: args.metadata.categoryId,
    tags: args.metadata.tags,
    scope: args.metadata.scope,
    teamId: args.metadata.teamId,
  };
}

/**
 * True if `next` differs from `prev` on any versioned metadata field. Used
 * by updatePrompt to decide whether a metadata-only edit should bump the
 * version (instead of just patching the row in place).
 */
export function metadataDiffers(
  prev: Pick<
    Doc<'promptTemplates'>,
    | 'title'
    | 'description'
    | 'category'
    | 'categoryId'
    | 'tags'
    | 'scope'
    | 'teamId'
  >,
  next: PromptVersionMetadata,
): boolean {
  if (prev.title !== next.title) return true;
  if ((prev.description ?? undefined) !== (next.description ?? undefined)) {
    return true;
  }
  // Both string and id are compared so that the lazy-migration write
  // (clears the seeded `category` string, stamps `categoryId`) is
  // recognized as a metadata change and bumps the version. The string
  // check is harmless when both fields are undefined.
  if ((prev.category ?? undefined) !== (next.category ?? undefined)) {
    return true;
  }
  if ((prev.categoryId ?? undefined) !== (next.categoryId ?? undefined)) {
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
