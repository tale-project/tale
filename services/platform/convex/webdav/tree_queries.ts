import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalQuery } from '../_generated/server';
import { isProjectScopedDocument } from '../documents/access';
import { findFolderByPath } from '../folders/find_folder_by_path';
import { isWebdavVisibleDocument } from './visibility';

// Cap children returned for a single PROPFIND. RFC 4918 doesn't paginate
// — clients expect one 207 multistatus per request — so we truncate to
// keep individual responses bounded. The lib layer surfaces a
// `truncated` flag that the handler turns into a `Tale-Truncated: 1`
// response header and a warning log. Followup ticket: NextCloud-style
// `X-NC-Paginate` cursor for clients that need full enumeration.
export const MAX_CHILDREN_PER_PROPFIND = 1000;

// Direct, streamable URL for a stored blob. Convex's native file-serving
// endpoint streams and supports HTTP Range WITHOUT loading the blob into a
// V8 isolate — unlike the /storage httpAction (ctx.storage.get), which
// buffers the whole blob in isolate memory and fails for files beyond the
// isolate limit. WebDAV GET prefers this URL so large downloads work, and
// falls back to the /storage proxy when it's null/unreachable. Returns
// null if the blob is gone.
export const getWebdavBlobUrl = internalQuery({
  args: { storageId: v.id('_storage') },
  async handler(ctx, args) {
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Path segments → either a folder id, a document id, or "not found".
// "root" is represented as folderId = null. Used by every method handler
// (PROPFIND/GET/PUT/DELETE/...) to map a WebDAV URL to backing rows.
//
// Folder-kind responses include `creationTime` so PROPFIND can emit
// `creationdate` / `getlastmodified` for the collection self-entry from
// real backing data instead of `new Date()`. Root has no backing row, so
// `creationTime` is null there.
export const resolvePath = internalQuery({
  args: {
    organizationId: v.string(),
    namespace: v.union(v.literal('documents'), v.literal('.trash')),
    segments: v.array(v.string()),
  },
  async handler(ctx, args) {
    if (args.segments.length === 0) {
      return { kind: 'root' as const, exists: true, creationTime: null };
    }
    return await resolvePathInner(
      ctx,
      args.organizationId,
      args.namespace,
      args.segments,
    );
  },
});

// Listing for a collection at the given folder. `folderId: null` means the
// org root. Returns child folders + child documents in one shot.
// Trash namespace returns trashed documents under the root only (no
// folder structure for trash in v1).
export const listCollection = internalQuery({
  args: {
    organizationId: v.string(),
    namespace: v.union(v.literal('documents'), v.literal('.trash')),
    folderId: v.union(v.id('folders'), v.null()),
  },
  async handler(ctx, args) {
    if (args.namespace === '.trash') {
      // Flat trash listing. Bounded with .take: the org-wide trash set is
      // unbounded and a .collect() of it would blow Convex's 32k-row / 16 MiB
      // single-query read ceiling (documents carry an inline `content` string,
      // so the byte limit can bind well before 32k rows). The
      // by_organizationId_and_lifecycleStatus index already orders by
      // _creationTime asc within the trashed bucket, so .take() yields the
      // oldest MAX_CHILDREN+1 — no in-memory sort needed.
      const taken = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('lifecycleStatus', 'trashed'),
        )
        .order('asc')
        .take(MAX_CHILDREN_PER_PROPFIND + 1);
      const truncated = taken.length > MAX_CHILDREN_PER_PROPFIND;
      // WebDAV is hub-only (#2545): a trashed project file stays invisible
      // here too — surfacing it in .trash would let any org member restore
      // or copy it back out of its project scope.
      const slice = (
        truncated ? taken.slice(0, MAX_CHILDREN_PER_PROPFIND) : taken
      ).filter((d) => !isProjectScopedDocument(d));
      return {
        folders: [],
        // Join fileMetadata so Depth:1 children carry size + contentType,
        // letting PROPFIND emit getcontentlength (directory views otherwise
        // show no file sizes). Bounded by the MAX_CHILDREN_PER_PROPFIND slice.
        documents: await Promise.all(
          slice.map((d) => joinDocumentMetadata(ctx, d)),
        ),
        truncated,
      };
    }

    const parentId = args.folderId ?? undefined;
    // Bounded like the document scan below: a folder with a very large flat
    // set of subfolders would otherwise .collect() past the single-query
    // read ceiling and hard-fail the PROPFIND. The hub-exact index pins
    // projectId=undefined so project folders never surface over WebDAV
    // (folder twin of isWebdavVisibleDocument, enforced at the index so
    // .take(cap+1) truncation detection stays exact); name-ordered with
    // org+projectId+parentId fixed.
    const rawFolders = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', undefined)
          .eq('parentId', parentId),
      )
      .take(MAX_CHILDREN_PER_PROPFIND + 1);
    const foldersHitReadCap = rawFolders.length > MAX_CHILDREN_PER_PROPFIND;
    const folders = rawFolders;

    // Bounded with .take: a very large flat folder would otherwise blow the
    // single-query read ceiling. by_organizationId_and_folderId orders by
    // _creationTime asc (org+folderId fixed), so .take() yields the oldest
    // MAX_CHILDREN+1. We filter trashed in memory afterward — taking +1 lets
    // us still detect truncation when the folder is exactly at the cap.
    const rawDocs = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_folderId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('folderId', args.folderId ?? undefined),
      )
      .order('asc')
      .take(MAX_CHILDREN_PER_PROPFIND + 1);
    const docsHitReadCap = rawDocs.length > MAX_CHILDREN_PER_PROPFIND;
    // Visibility = active AND not project-scoped (#2545): project files are
    // hard-scoped to their project and must never list as hub documents.
    const docs = rawDocs.filter((d) => isWebdavVisibleDocument(d));

    // Cap the COMBINED count at MAX_CHILDREN_PER_PROPFIND. Folders win the cap
    // since collections are usually fewer and clients lean on them for tree
    // expansion; truncating leaf docs is the safer failure mode than hiding
    // subfolders. Child order is not RFC-significant (clients re-sort): folders
    // arrive name-ordered (the index), docs _creationTime-ordered (.take).
    const sortedFolders = folders;
    const sortedDocs = docs;

    const total = sortedFolders.length + sortedDocs.length;
    const truncated =
      total > MAX_CHILDREN_PER_PROPFIND || docsHitReadCap || foldersHitReadCap;

    let folderSlice = sortedFolders;
    let docSlice = sortedDocs;
    if (truncated) {
      if (sortedFolders.length >= MAX_CHILDREN_PER_PROPFIND) {
        folderSlice = sortedFolders.slice(0, MAX_CHILDREN_PER_PROPFIND);
        docSlice = [];
      } else {
        folderSlice = sortedFolders;
        docSlice = sortedDocs.slice(
          0,
          MAX_CHILDREN_PER_PROPFIND - sortedFolders.length,
        );
      }
    }

    return {
      folders: folderSlice.map((f) => ({
        _id: f._id,
        name: f.name,
        creationTime: f._creationTime,
      })),
      documents: await Promise.all(
        docSlice.map((d) => joinDocumentMetadata(ctx, d)),
      ),
      truncated,
    };
  },
});

// Document props for PROPFIND on a single resource (or after Depth=1
// child enumeration). Joins fileMetadata for size + contentType.
export const getDocumentProps = internalQuery({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
  },
  async handler(ctx, args) {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.organizationId !== args.organizationId) return null;
    // Defense-in-depth: resolvePath never yields a project-scoped document,
    // but a stale/forged id must not leak project props either (#2545).
    if (isProjectScopedDocument(doc)) return null;
    return await joinDocumentMetadata(ctx, doc);
  },
});

// --- helpers ---

type DocumentMeta = ReturnType<typeof documentRowToMeta>;

function documentRowToMeta(doc: Doc<'documents'>) {
  return {
    _id: doc._id,
    title: doc.title ?? '(untitled)',
    mimeType: doc.mimeType,
    extension: doc.extension,
    fileId: doc.fileId,
    contentHash: doc.contentHash,
    creationTime: doc._creationTime,
    sourceModifiedAt: doc.sourceModifiedAt,
    folderId: doc.folderId,
    lifecycleStatus: doc.lifecycleStatus,
  };
}

async function joinDocumentMetadata(
  ctx: QueryCtx,
  doc: Doc<'documents'>,
): Promise<
  DocumentMeta & {
    size: number | null;
    contentType: string | null;
  }
> {
  let size: number | null = null;
  let contentType: string | null = doc.mimeType ?? null;
  const fileId = doc.fileId;
  if (fileId) {
    const fm = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
      .first();
    if (fm) {
      size = fm.size;
      contentType = fm.contentType;
    }
  }
  return { ...documentRowToMeta(doc), size, contentType };
}

async function resolvePathInner(
  ctx: QueryCtx,
  organizationId: string,
  namespace: 'documents' | '.trash',
  segments: string[],
): Promise<
  | { kind: 'root'; exists: true; creationTime: null }
  | {
      kind: 'folder';
      folderId: Id<'folders'>;
      exists: true;
      creationTime: number;
    }
  | { kind: 'document'; documentId: Id<'documents'>; exists: true }
  | { kind: 'not_found'; exists: false }
> {
  // Trash namespace is flat in v1 — only direct children of root are
  // visible. A multi-segment path under .trash never resolves.
  if (namespace === '.trash') {
    if (segments.length !== 1) return { kind: 'not_found', exists: false };
    // Exact indexed lookup — never collect every trashed doc in the org
    // (a large trash would blow the read ceiling and make .trash files
    // un-GET-able). Title is required to be non-empty here (segments[0] is
    // a path segment), so docs with an undefined title never matched the
    // prior `(title ?? '') === segment` check either.
    // .collect() over the exact-title matches (few — same-name trashed docs)
    // so an invisible project doc can't shadow, or leak as, the trash entry
    // (#2545 hub-only rule).
    const trashMatches = await ctx.db
      .query('documents')
      .withIndex('by_org_lifecycle_title', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('lifecycleStatus', 'trashed')
          .eq('title', segments[0]),
      )
      .collect();
    const match = trashMatches.find((d) => !isProjectScopedDocument(d));
    if (match) {
      return { kind: 'document', documentId: match._id, exists: true };
    }
    return { kind: 'not_found', exists: false };
  }

  // documents namespace — walk segments via folders/find_folder_by_path
  // for the parent prefix, then check the final segment as either a
  // folder name (collection) or document title (resource).
  if (segments.length === 1) {
    const onlyName = segments[0];
    // Hub-exact: a project folder sharing the name at root must resolve as
    // not-found over WebDAV.
    const folder = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('projectId', undefined)
          .eq('parentId', undefined)
          .eq('name', onlyName),
      )
      .first();
    if (folder) {
      return {
        kind: 'folder',
        folderId: folder._id,
        exists: true,
        creationTime: folder._creationTime,
      };
    }
    const docId = await resolveLeafDocument(
      ctx,
      organizationId,
      undefined,
      onlyName,
    );
    if (docId) return { kind: 'document', documentId: docId, exists: true };
    return { kind: 'not_found', exists: false };
  }

  const parentSegments = segments.slice(0, -1);
  const leafName = segments[segments.length - 1];
  const parentFolderId = await findFolderByPath(
    ctx,
    organizationId,
    parentSegments,
  );
  if (!parentFolderId) return { kind: 'not_found', exists: false };

  // Try child folder first (hub-exact — children of a hub parent are hub
  // folders by invariant; the pinned index keeps that assumption enforced).
  const childFolder = await ctx.db
    .query('folders')
    .withIndex('by_org_project_parent_name', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('projectId', undefined)
        .eq('parentId', parentFolderId)
        .eq('name', leafName),
    )
    .first();
  if (childFolder) {
    return {
      kind: 'folder',
      folderId: childFolder._id,
      exists: true,
      creationTime: childFolder._creationTime,
    };
  }

  // Then child document
  const docId = await resolveLeafDocument(
    ctx,
    organizationId,
    parentFolderId,
    leafName,
  );
  if (docId) {
    return { kind: 'document', documentId: docId, exists: true };
  }
  return { kind: 'not_found', exists: false };
}

// Resolve a leaf segment to an active document in a folder. Matches by
// title first; if that fails, decodes the `<title>_<docId>` form PROPFIND
// uses to disambiguate same-title siblings (see methods/propfind.ts) so
// the deduped href round-trips back to the right document instead of
// 404ing. Without this, two siblings sharing a title become un-openable
// and un-deletable through their listed URLs.
async function resolveLeafDocument(
  ctx: QueryCtx,
  organizationId: string,
  folderId: Id<'folders'> | undefined,
  leafName: string,
): Promise<Id<'documents'> | null> {
  // Exact (org, title, folder) match — the composite index bounds the scan
  // to same-name docs in THIS folder, so a name repeated across a synced
  // tree can't blow the read ceiling. Same-name docs in one folder are few.
  const titleMatches = await ctx.db
    .query('documents')
    .withIndex('by_org_title_folder', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('title', leafName)
        .eq('folderId', folderId),
    )
    .collect();
  const exact = titleMatches.find((d) => isWebdavVisibleDocument(d));
  if (exact) return exact._id;

  // `<title>_<docId>` disambiguation. The docId is the final `_`-delimited
  // token (Convex ids contain no underscores); the title may itself
  // contain underscores, so split on the LAST one and verify both halves.
  // Resolve the id directly (a single get) rather than re-scanning the folder.
  const underscore = leafName.lastIndexOf('_');
  if (underscore > 0) {
    const titlePrefix = leafName.slice(0, underscore);
    const idPart = leafName.slice(underscore + 1);
    const normalized = ctx.db.normalizeId('documents', idPart);
    if (normalized) {
      const doc = await ctx.db.get(normalized);
      if (
        doc &&
        doc.organizationId === organizationId &&
        (doc.folderId ?? undefined) === folderId &&
        isWebdavVisibleDocument(doc) &&
        (doc.title ?? '') === titlePrefix
      ) {
        return doc._id;
      }
    }
  }
  return null;
}
