import {
  getFileExtensionLower,
  isTextBasedFile,
} from '@/lib/utils/text-file-types';

export type FileViewerRenderKind =
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
 * Pick the Canvas viewer for a workspace file. A server `renderHint`, when
 * present, wins; otherwise infer from path extension and content type (the
 * path user uploads take when `renderHint` is omitted).
 */
export function resolveFileViewerKind(
  hint: string | undefined,
  path: string,
  contentType: string | undefined,
): FileViewerRenderKind {
  if (
    hint === 'image' ||
    hint === 'attachment' ||
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
