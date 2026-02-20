/**
 * Content Hash
 *
 * Simple hash for detecting content changes in website pages.
 * Uses DJB2 algorithm - fast, deterministic, and sufficient for change detection.
 */

export function computeContentHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
