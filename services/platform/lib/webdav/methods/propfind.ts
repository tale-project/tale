import { anyApi } from 'convex/server';

import { buildDavPath } from '../paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';
import { buildMultiStatus, type ResourceProps } from '../xml/propfind-response';

export async function handlePropfind(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  const depthHeader = req.headers.get('depth') ?? 'infinity';

  // RFC 4918 §9.1: servers MAY reject Depth: infinity to prevent
  // unbounded tree dumps. We do — Finder / Explorer / iOS use 0 or 1.
  if (depthHeader.toLowerCase() === 'infinity') {
    return {
      status: 403,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>`,
    };
  }
  const depth = depthHeader === '0' ? 0 : 1;

  // Resolve the URL to a node — root, folder, or document.
  const resolved = await ctx.convex.query(
    anyApi.webdav.tree_queries.resolvePath,
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

  // Self
  if (resolved.kind === 'root' || resolved.kind === 'folder') {
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
      lastModified: new Date(),
      creationDate: new Date(),
    });
  } else {
    const doc = await ctx.convex.query(
      anyApi.webdav.tree_queries.getDocumentProps,
      {
        organizationId: auth.organizationId,
        documentId: resolved.documentId,
      },
    );
    if (!doc) {
      return { status: 404, headers: {}, body: 'Not found' };
    }
    props.push(documentToProps(doc, parsed, auth.orgSlug));
  }

  if (depth === 1 && (resolved.kind === 'root' || resolved.kind === 'folder')) {
    const folderId = resolved.kind === 'folder' ? resolved.folderId : null;
    const listing = await ctx.convex.query(
      anyApi.webdav.tree_queries.listCollection,
      {
        organizationId: auth.organizationId,
        namespace: parsed.namespace,
        folderId,
      },
    );
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
    }
    for (const child of listing.documents) {
      const childParsed = {
        orgSlug: auth.orgSlug,
        namespace: parsed.namespace,
        segments: [...parsed.segments, child.title],
        isCollection: false,
      };
      props.push(documentToProps(child, childParsed, auth.orgSlug));
    }
  }

  return {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: buildMultiStatus(props),
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
    etag: doc.contentHash ?? doc._id ?? null,
  };
}
