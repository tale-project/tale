import {
  getFileExtensionLower,
  isTextBasedFile,
} from '@/lib/utils/text-file-types';

export type RenderKind =
  | 'image'
  | 'attachment'
  | 'html'
  | 'svg'
  | 'mermaid'
  | 'markdown'
  | 'code';

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
]);

/**
 * Single source of truth for "how does this thread file render" — the viewer
 * router picks a viewer from it and `useThreadFileContent` decides from it
 * whether the body is worth fetching (image/attachment stop at the URL).
 * Keeping both on one resolver is what guarantees they agree: a kind that
 * fetches no text must never route to a text viewer and vice versa.
 *
 * Hints are authoritative except `'attachment'`, which is only advisory:
 * until #2677 the upload path stamped it on every non-image byte it filed,
 * so a stored `'attachment'` mostly means "nobody looked". Inference re-checks
 * it — genuinely binary content still resolves to `'attachment'`, while the
 * uploaded `.md`/`.svg`/`.py` those rows actually hold render like their
 * agent-written twins (and existing mis-stamped rows heal without a
 * migration).
 */
export function resolveRenderKind(
  hint: string | undefined,
  path: string,
  contentType: string | undefined,
): RenderKind {
  if (
    hint === 'image' ||
    hint === 'html' ||
    hint === 'svg' ||
    hint === 'mermaid' ||
    hint === 'markdown' ||
    hint === 'code'
  ) {
    return hint;
  }
  const ext = getFileExtensionLower(path);
  if (IMAGE_EXTS.has(ext) || contentType?.startsWith('image/')) return 'image';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'svg') return 'svg';
  if (ext === 'mmd' || ext === 'mermaid') return 'mermaid';
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown';
  if (!isTextBasedFile(path, contentType)) return 'attachment';
  return 'code';
}
