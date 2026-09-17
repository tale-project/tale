/** The corpus row counts attempted pages, including failures. The UI's
 * Indexed total excludes failed attempts, as the website contract specifies. */
export function indexedPageCount(website: {
  crawledPageCount?: number | null;
  failedPageCount?: number | null;
}): number {
  return Math.max(
    0,
    (website.crawledPageCount ?? 0) - (website.failedPageCount ?? 0),
  );
}
