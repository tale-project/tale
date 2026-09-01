import { anyRefs } from '../../shared/handlers/function-refs';
import { buildDavPath, lockKeyFromParsed } from '../paths';
import {
  WEBDAV_MAX_XML_BODY,
  WebDAVBodyTooLarge,
  type AuthContext,
  type ParsedPath,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';
import { parsePropfindBody } from '../xml/propfind-request';
import {
  type ActiveLockInfo,
  buildMultiStatus,
  type ResourceProps,
} from '../xml/propfind-response';
import { computeETag } from './get';

// Hard cap on the number of children we'll annotate with lock data per
// PROPFIND. Lock lookup is one Convex query per resource (no batch
// endpoint in v1), so we bound the fan-out. Anything above this cap
// still appears in the response — just without lockdiscovery info,
// which the client will discover on first method that touches it.
const MAX_LOCK_LOOKUPS_PER_PROPFIND = 64;

export async function handlePropfind(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  // Depth policy (RFC 4918 §9.1):
  //   - missing header → spec says "treat as infinity", which we read
  //     as a client that didn't bother to set it. We default to 1
  //     (the most useful answer for Finder/Explorer/iOS), NOT infinity.
  //   - "0"            → just the addressed resource.
  //   - "1"            → resource + immediate children.
  //   - "infinity"     → unbounded tree. We refuse with 403 +
  //                      `<D:propfind-finite-depth/>` to prevent
  //                      adversarial / accidental tree dumps.
  const depthHeader = req.headers.get('depth');
  if (depthHeader !== null && depthHeader.toLowerCase() === 'infinity') {
    return {
      status: 403,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>`,
    };
  }
  const depth = depthHeader === '0' ? 0 : 1;

  // Parse selector (allprop / propname / prop list). Empty body is the
  // Finder default and resolves to allprop inside parsePropfindBody.
  let bodyText = '';
  try {
    bodyText = await req.readText(WEBDAV_MAX_XML_BODY);
  } catch (err) {
    // An over-cap body must surface as 413 (dispatch maps it), not be
    // silently treated as an empty/allprop request.
    if (err instanceof WebDAVBodyTooLarge) throw err;
    console.warn('[webdav] propfind body read failed', err);
    bodyText = '';
  }
  const propfindRequest = parsePropfindBody(bodyText);

  // Resolve the URL to a node — root, folder, or document.
  const resolved = await ctx.backend.query(
    anyRefs.webdav.tree_queries.resolvePath,
    {
      organizationId: auth.organizationId,
      namespace: parsed.namespace,
      segments: parsed.segments,
    },
  );

  if (!resolved.exists) {
    return { status: 404, headers: {}, body: 'Not found' };
  }

  const props: ResourceProps[] = [];
  const lockKeysToLookUp: { path: string; index: number }[] = [];

  // Self
  if (resolved.kind === 'root' || resolved.kind === 'folder') {
    // Self-entry timestamps: root has no backing row, so we fall back
    // to "now" (it's a pseudo-collection). For real folders we use the
    // folder's _creationTime — there's no separate modified-at column,
    // so creationDate and getlastmodified collapse to the same value.
    const folderTime =
      resolved.kind === 'folder' && resolved.creationTime !== null
        ? new Date(resolved.creationTime)
        : new Date();
    props.push({
      href: buildDavPath({
        orgSlug: auth.orgSlug,
        namespace: parsed.namespace,
        segments: parsed.segments,
        isCollection: true,
      }),
      isCollection: true,
      displayName:
        parsed.segments.length === 0
          ? parsed.namespace
          : parsed.segments[parsed.segments.length - 1],
      lastModified: folderTime,
      creationDate: folderTime,
    });
    lockKeysToLookUp.push({
      path: lockKeyFromParsed(parsed),
      index: props.length - 1,
    });
  } else {
    const doc = await ctx.backend.query(
      anyRefs.webdav.tree_queries.getDocumentProps,
      {
        organizationId: auth.organizationId,
        documentId: resolved.documentId,
      },
    );
    if (!doc) {
      return { status: 404, headers: {}, body: 'Not found' };
    }
    props.push(documentToProps(doc, parsed, auth.orgSlug));
    lockKeysToLookUp.push({
      path: lockKeyFromParsed(parsed),
      index: props.length - 1,
    });
  }

  let truncated = false;

  if (depth === 1 && (resolved.kind === 'root' || resolved.kind === 'folder')) {
    const folderId = resolved.kind === 'folder' ? resolved.folderId : null;
    const listing = await ctx.backend.query(
      anyRefs.webdav.tree_queries.listCollection,
      {
        organizationId: auth.organizationId,
        namespace: parsed.namespace,
        folderId,
      },
    );
    truncated = Boolean(listing.truncated);
    for (const child of listing.folders) {
      const childSegments = [...parsed.segments, child.name];
      props.push({
        href: buildDavPath({
          orgSlug: auth.orgSlug,
          namespace: parsed.namespace,
          segments: childSegments,
          isCollection: true,
        }),
        isCollection: true,
        displayName: child.name,
        lastModified: new Date(child.creationTime),
        creationDate: new Date(child.creationTime),
      });
      lockKeysToLookUp.push({
        path: lockKeyFromParsed({
          namespace: parsed.namespace,
          segments: childSegments,
        }),
        index: props.length - 1,
      });
    }

    // Dedupe child document hrefs by title. Two active sibling docs
    // with the same title would otherwise collide on `<D:href>` —
    // some clients (davfs2, NextCloud sync) silently drop duplicates
    // and the user loses the second file from the listing. We suffix
    // `_<docId>` to make the URL unique. The doc itself is still
    // resolvable: PROPFIND only needs href-level uniqueness; method
    // handlers fall back to title-then-id lookup on resolve.
    const titleCounts = new Map<string, number>();
    for (const child of listing.documents) {
      titleCounts.set(child.title, (titleCounts.get(child.title) ?? 0) + 1);
    }
    for (const child of listing.documents) {
      const collides = (titleCounts.get(child.title) ?? 0) > 1;
      const displayTitle = collides
        ? `${child.title}_${child._id}`
        : child.title;
      const childParsed = {
        orgSlug: auth.orgSlug,
        namespace: parsed.namespace,
        segments: [...parsed.segments, displayTitle],
        isCollection: false,
      };
      props.push(
        documentToProps(
          { ...child, title: displayTitle },
          childParsed,
          auth.orgSlug,
        ),
      );
      lockKeysToLookUp.push({
        path: lockKeyFromParsed({
          namespace: parsed.namespace,
          segments: [...parsed.segments, displayTitle],
        }),
        index: props.length - 1,
      });
    }
  }

  // Fetch active locks for each resource we just enumerated. v1: one
  // findLockForPath per resource, bounded by MAX_LOCK_LOOKUPS_PER_PROPFIND
  // to keep PROPFIND latency manageable in pathological cases. A bulk
  // query would be a clean followup but isn't required for correctness.
  const lookups = lockKeysToLookUp.slice(0, MAX_LOCK_LOOKUPS_PER_PROPFIND);
  await Promise.all(
    lookups.map(async ({ path, index }) => {
      try {
        const result = await ctx.backend.query(
          anyRefs.webdav.lock_queries.findLockForPath,
          {
            organizationId: auth.organizationId,
            resourcePath: path,
          },
        );
        if (result?.lock) {
          props[index].activeLock = lockRowToActiveLock(result.lock);
        }
      } catch (err) {
        // Lock annotation is best-effort — failure to read should not
        // sink the whole PROPFIND. Log loudly so we notice systemic
        // breakage.
        console.warn('[webdav] propfind lock lookup failed', { path, err });
      }
    }),
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/xml; charset=utf-8',
  };
  if (truncated) {
    headers['Tale-Truncated'] = '1';
    console.warn('[webdav] propfind result truncated', {
      organizationId: auth.organizationId,
      namespace: parsed.namespace,
      segments: parsed.segments,
    });
  }

  return {
    status: 207,
    headers,
    body: buildMultiStatus(props, propfindRequest),
  };
}

function lockRowToActiveLock(lock: {
  lockToken: string;
  ownerXml: string;
  depth: '0' | 'infinity';
  scope: 'exclusive' | 'shared';
  expiresAt: number;
}): ActiveLockInfo {
  return {
    lockToken: lock.lockToken,
    scope: lock.scope,
    depth: lock.depth,
    ownerXml: lock.ownerXml,
    timeoutSeconds: Math.max(
      0,
      Math.floor((lock.expiresAt - Date.now()) / 1000),
    ),
  };
}

function documentToProps(
  doc: {
    title?: string;
    mimeType?: string | null;
    contentType?: string | null;
    size?: number | null;
    creationTime?: number;
    sourceModifiedAt?: number;
    contentHash?: string | null;
    _id?: string;
  },
  parsed: {
    namespace: 'documents' | '.trash';
    segments: string[];
    isCollection?: boolean;
  },
  orgSlug: string,
): ResourceProps {
  const title = doc.title ?? '(untitled)';
  const segments = parsed.segments.length > 0 ? parsed.segments : [title];
  // Use the exact same validator GET emits (quotes + `W/` marker
  // included) so DAV:getetag and the GET ETag header never diverge. The
  // previous local fallback double-quoted the weak form into `"W/"…""`.
  const etag = computeETag(doc);
  return {
    href: buildDavPath({
      orgSlug,
      namespace: parsed.namespace,
      segments,
      isCollection: false,
    }),
    isCollection: false,
    displayName: title,
    contentType: doc.contentType ?? doc.mimeType ?? 'application/octet-stream',
    contentLength: doc.size ?? null,
    lastModified: new Date(
      doc.sourceModifiedAt ?? doc.creationTime ?? Date.now(),
    ),
    creationDate: new Date(doc.creationTime ?? Date.now()),
    etag,
  };
}
