/**
 * Shared document access layer.
 *
 * Documents live in exactly one of two scopes (`projectId` and `teamId` are
 * mutually exclusive):
 *
 * - Knowledge Hub (org/team library): `projectId` unset.
 * - Project files: `projectId` set. Never part of the Knowledge Hub; readable
 *   only through the owning project's own surfaces.
 *
 * The scope decision has one owner — this module — so every hub read path
 * (lists, pickers, agent scopes, REST, WebDAV) applies the same predicate.
 */

import type { Doc } from '../_generated/dataModel';

type DocumentScopeFields = Pick<
  Doc<'documents'>,
  'projectId' | 'teamId' | 'teamTags'
>;

/**
 * A document attached to a project. Such documents are not Knowledge Hub
 * rows: they must never surface in org/team library listings, pickers, or
 * agent knowledge scopes outside their project.
 */
export function isProjectScopedDocument(doc: DocumentScopeFields): boolean {
  return doc.projectId != null;
}
