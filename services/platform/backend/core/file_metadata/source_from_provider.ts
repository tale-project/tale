/**
 * Map a document's `sourceProvider` to the fileMetadata `source` provenance,
 * used when a raw blob is promoted to a document (linkDocumentToFile) and by the
 * backfill migration that repairs pre-existing rows.
 *
 *  - 'upload'            → 'user'   (document layer says 'upload'; fileMetadata
 *                                    records member uploads as 'user')
 *  - 'agent' / undefined → undefined ("leave the existing source untouched":
 *                                    model-generated, or provenance unknown)
 *  - anything else       → the connector slug verbatim ('confluence',
 *                          'google_drive', 'onedrive', 'sharepoint', 'webdav',
 *                          any connector slug) — an external import
 *
 * Only 'user'/'agent' are swept by the temp-retention GC, so import slugs are
 * inherently retention-safe. Returning undefined means "do not change source".
 */
export function sourceFromProvider(
  sourceProvider: string | undefined,
): string | undefined {
  if (sourceProvider === 'upload') {
    return 'user';
  }
  if (!sourceProvider || sourceProvider === 'agent') {
    return undefined;
  }
  return sourceProvider;
}
