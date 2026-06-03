/**
 * Pure helpers for parsing the upload-policy extension lists. Kept out of
 * `upload-policy-editor.tsx` so that file only exports its React component —
 * mixing component and non-component exports breaks React Fast Refresh.
 */

export function stringToExtensions(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^\./, ''))
    .filter(Boolean);
}

/**
 * Returns the extensions present in BOTH the allowed and blocked lists
 * (case-insensitive). Used to reject a contradictory upload policy (#1479).
 */
export function findConflictingExtensions(
  allowedValue: string,
  blockedValue: string,
): string[] {
  const allowed = new Set(
    (stringToExtensions(allowedValue) ?? []).map((e) => e.toLowerCase()),
  );
  return (stringToExtensions(blockedValue) ?? []).filter((e) =>
    allowed.has(e.toLowerCase()),
  );
}
