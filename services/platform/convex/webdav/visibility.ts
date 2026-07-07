// WebDAV document visibility — hub-only surface (#2545).
//
// Project-scoped documents (`documents.projectId` set) are hard-scoped to
// their owning project and are NOT hub rows. WebDAV authenticates with an
// app password and the Hono-trust split asserts only (org, user) — it cannot
// evaluate project membership — so project files behave as not-found for
// every caller, mirroring the REST API's opaque 404s. Project members reach
// their files through the project surfaces instead.

import type { Doc } from '../_generated/dataModel';
import { isProjectScopedDocument } from '../documents/access';

// The visibility predicate every WebDAV listing, leaf resolution, and
// name-collision lookup must apply: active AND not project-scoped.
export function isWebdavVisibleDocument(doc: Doc<'documents'>): boolean {
  return (
    (doc.lifecycleStatus ?? 'active') === 'active' &&
    !isProjectScopedDocument(doc)
  );
}
