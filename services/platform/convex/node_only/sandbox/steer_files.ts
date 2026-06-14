// Pure helpers for the mid-turn steering file contract shared by the delivery
// action (stages steer-*.json), the drain's consumption poll, and the terminal
// reconciliation (both read consumed.* markers). Keeping the filename contract
// and the consumed-marker intersection in one dependency-free module means the
// three call sites cannot drift apart.

/** Filename for a staged steer message. The hook consumes `steer-*.json` and
 * renames to `consumed.<name>`, so the platform can reconcile from a directory
 * listing alone. createdAt prefix keeps the hook's glob-sort in send order. */
export function steerFileName(createdAt: number, messageId: string): string {
  return `steer-${String(createdAt).padStart(15, '0')}-${messageId}.json`;
}

export function steerDirFor(execId: string): string {
  return `.tale/steer/${execId}`;
}

/** Pure intersection of the platform's delivered queue rows with a steer-dir
 * listing: the messageIds whose staged file the in-sandbox hook consumed
 * (atomically renamed to `consumed.<name>`). `entries === null` (dir or
 * session gone) ⇒ nothing consumed — callers must treat that as "stay
 * pending", never as evidence of consumption or session death. */
export function matchConsumedSteerFiles(
  delivered: ReadonlyArray<{ messageId: string; createdAt: number }>,
  entries: ReadonlyArray<{ name: string; type: string }> | null,
): string[] {
  if (entries === null || entries.length === 0) return [];
  const consumedNames = new Set(
    entries
      .filter((e) => e.type === 'file' && e.name.startsWith('consumed.'))
      .map((e) => e.name),
  );
  return delivered
    .filter((row) =>
      consumedNames.has(
        `consumed.${steerFileName(row.createdAt, row.messageId)}`,
      ),
    )
    .map((row) => row.messageId);
}
