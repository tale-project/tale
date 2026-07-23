/**
 * Extract the `id` query param from a Convex storage URL, or undefined when the
 * URL has no `id` or can't be parsed.
 */
export function extractStorageFileId(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('id') ?? undefined;
  } catch {
    return undefined;
  }
}
