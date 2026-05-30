import type { Doc } from '../_generated/dataModel';

/**
 * Documents flipped to `'trashed'` via WebDAV soft-delete (and other
 * retention paths) must not surface in normal listing/search queries.
 * Active rows have `lifecycleStatus === 'active'` or `undefined`
 * (legacy rows before the field existed). Use this in every listing
 * pipeline so the filter stays consistent across files.
 */
export function isActiveDocument(
  doc: Pick<Doc<'documents'>, 'lifecycleStatus'>,
): boolean {
  return doc.lifecycleStatus !== 'trashed';
}
