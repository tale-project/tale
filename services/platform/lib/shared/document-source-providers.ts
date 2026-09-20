/**
 * A document's `sourceProvider` says who OWNS the row: a member ('upload') or
 * an agent ('agent') authored it here, while any other value is a connector
 * slug ('onedrive', 'google_drive', 'sharepoint', 'confluence', 'webdav', …)
 * whose external sync loop rewrites — and restores — the row. Two gates rest
 * on that line and read it from here, so they cannot drift apart:
 *
 *  - only an authored document can become a controlled record (the server
 *    refuses sync-owned sources, `backend/domains/documents/records.ts`);
 *  - only an authored document is offered a Delete on its project row —
 *    deleting a synced file just invites the next sync to bring it back.
 *
 * An absent or empty provider reads as 'upload', matching the document view
 * (`backend/domains/documents/view.ts` defaults `sourceProvider` to 'upload').
 */
export const AUTHORED_SOURCE_PROVIDERS: ReadonlySet<string> = new Set([
  'upload',
  'agent',
]);

export function isAuthoredSourceProvider(
  sourceProvider: string | null | undefined,
): boolean {
  if (
    sourceProvider === undefined ||
    sourceProvider === null ||
    sourceProvider === ''
  ) {
    return true;
  }
  return AUTHORED_SOURCE_PROVIDERS.has(sourceProvider);
}
