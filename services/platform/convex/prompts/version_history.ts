import { MAX_PROMPT_VERSION_HISTORY } from './constants';

export type VersionHistoryEntry = {
  version: number;
  content: string;
  publishedAt: number;
  publishedBy: string;
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
