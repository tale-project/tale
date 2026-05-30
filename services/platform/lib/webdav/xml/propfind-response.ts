// Build a 207 Multi-Status body for PROPFIND. We honor RFC 4918 §9.1
// selector semantics:
//
//   <allprop/>  → emit every live property we know about, status 200.
//   <propname/> → emit only the element names (empty bodies), status 200.
//                 No 404 group, since the client is asking what we have.
//   <prop>      → emit each requested name with its value if known
//                 (status 200), and group any unknown names under a
//                 second <propstat> with `HTTP/1.1 404 Not Found`.
//
// Dead properties are not stored in v1, so any name outside the live
// set always 404s in `prop` mode.
//
// `activeLock` is plumbed through so PROPFIND can emit a real
// <D:lockdiscovery> stanza for resources that currently hold a lock —
// otherwise lockdiscovery is emitted as an empty element (the RFC-MUST
// answer for "no lock"). <D:supportedlock> is always emitted unchanged.

import type { PropfindRequest } from './propfind-request';

export interface ActiveLockInfo {
  lockToken: string; // bare UUID; wrapped as opaquelocktoken: on emit
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  ownerXml: string;
  // Seconds remaining until expiry. Negative timeouts are clamped to 0
  // by the caller (we treat expired locks as absent before reaching here).
  timeoutSeconds: number;
  // Wire href of the lock root. We don't always have this at the
  // call site; when omitted the response href is reused.
  lockRootHref?: string;
}

export interface ResourceProps {
  href: string;
  isCollection: boolean;
  displayName: string;
  contentType?: string | null;
  contentLength?: number | null;
  lastModified: Date; // RFC 1123 format
  creationDate: Date; // ISO-8601
  etag?: string | null;
  activeLock?: ActiveLockInfo | null;
}

// All live property names we surface. Keep this in sync with the
// renderers in `renderPropValue` / `renderPropName`. Used for
// `<allprop/>` enumeration and to decide which `<prop>` names get a 200
// vs 404 status.
const LIVE_PROPS = [
  'resourcetype',
  'displayname',
  'getlastmodified',
  'creationdate',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'supportedlock',
  'lockdiscovery',
] as const;

type LiveProp = (typeof LIVE_PROPS)[number];

const LIVE_PROP_SET: ReadonlySet<LiveProp> = new Set(LIVE_PROPS);

function isLiveProp(name: string): name is LiveProp {
  return (LIVE_PROP_SET as ReadonlySet<string>).has(name);
}

export function buildMultiStatus(
  resources: ResourceProps[],
  request: PropfindRequest = { kind: 'allprop' },
): string {
  const responses = resources.map((r) => renderResponse(r, request)).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
}

function renderResponse(r: ResourceProps, request: PropfindRequest): string {
  if (request.kind === 'propname') {
    return renderPropnameResponse(r);
  }

  if (request.kind === 'allprop') {
    const propsXml = LIVE_PROPS.filter((name) => isApplicable(name, r))
      .map((name) => renderPropValue(name, r))
      .join('\n      ');
    return wrapSinglePropstat(r.href, propsXml);
  }

  // request.kind === 'prop' — partition into found / not-found.
  const found: string[] = [];
  const notFound: string[] = [];
  for (const name of request.props) {
    if (isLiveProp(name) && isApplicable(name, r)) {
      found.push(renderPropValue(name, r));
    } else {
      // Either an unknown name (dead prop / typo) or a live prop that
      // doesn't apply to this resource type (e.g. getcontentlength on
      // a collection). RFC 4918 §9.1: both go in the 404 group.
      notFound.push(renderEmptyProp(name));
    }
  }

  const foundXml = found.join('\n      ');
  const okPropstat =
    found.length > 0
      ? `  <D:propstat>
    <D:prop>
      ${foundXml}
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>`
      : '';
  const notFoundXml = notFound.join('\n      ');
  const missingPropstat =
    notFound.length > 0
      ? `  <D:propstat>
    <D:prop>
      ${notFoundXml}
    </D:prop>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:propstat>`
      : '';

  return `<D:response>
  <D:href>${escapeXml(r.href)}</D:href>
${okPropstat}${okPropstat && missingPropstat ? '\n' : ''}${missingPropstat}
</D:response>`;
}

function renderPropnameResponse(r: ResourceProps): string {
  const names = LIVE_PROPS.filter((name) => isApplicable(name, r))
    .map(renderEmptyProp)
    .join('\n      ');
  return wrapSinglePropstat(r.href, names);
}

function wrapSinglePropstat(href: string, innerProps: string): string {
  return `<D:response>
  <D:href>${escapeXml(href)}</D:href>
  <D:propstat>
    <D:prop>
      ${innerProps}
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
</D:response>`;
}

// Whether a given live prop applies to this resource. Collections
// never have getcontentlength / getcontenttype / getetag — RFC says
// these are file-only and emitting them for a collection confuses
// some clients (Office for Mac in particular).
function isApplicable(name: LiveProp, r: ResourceProps): boolean {
  if (r.isCollection) {
    if (
      name === 'getcontentlength' ||
      name === 'getcontenttype' ||
      name === 'getetag'
    ) {
      return false;
    }
    return true;
  }
  // File-side props: only emit getcontentlength when we actually know
  // it (size === null happens when fileMetadata isn't joined yet).
  if (name === 'getcontentlength') {
    return r.contentLength !== undefined && r.contentLength !== null;
  }
  if (name === 'getcontenttype') {
    return Boolean(r.contentType);
  }
  if (name === 'getetag') {
    return Boolean(r.etag);
  }
  return true;
}

function renderPropValue(name: LiveProp, r: ResourceProps): string {
  switch (name) {
    case 'resourcetype': {
      const inner = r.isCollection ? '<D:collection/>' : '';
      return `<D:resourcetype>${inner}</D:resourcetype>`;
    }
    case 'displayname':
      return `<D:displayname>${escapeXml(r.displayName)}</D:displayname>`;
    case 'getlastmodified':
      return `<D:getlastmodified>${escapeXml(r.lastModified.toUTCString())}</D:getlastmodified>`;
    case 'creationdate':
      return `<D:creationdate>${escapeXml(r.creationDate.toISOString())}</D:creationdate>`;
    case 'getcontentlength':
      return `<D:getcontentlength>${r.contentLength}</D:getcontentlength>`;
    case 'getcontenttype':
      return `<D:getcontenttype>${escapeXml(r.contentType ?? 'application/octet-stream')}</D:getcontenttype>`;
    case 'getetag':
      return `<D:getetag>"${escapeXml(r.etag ?? '')}"</D:getetag>`;
    case 'supportedlock':
      return SUPPORTED_LOCK_XML;
    case 'lockdiscovery':
      return renderLockDiscovery(r);
    default: {
      // LIVE_PROPS is the exhaustive list; a new entry there without a
      // corresponding case here is a compile-time bug, not a runtime
      // one. The never assertion locks that in.
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

const SUPPORTED_LOCK_XML = `<D:supportedlock>
        <D:lockentry>
          <D:lockscope><D:exclusive/></D:lockscope>
          <D:locktype><D:write/></D:locktype>
        </D:lockentry>
      </D:supportedlock>`;

function renderLockDiscovery(r: ResourceProps): string {
  const lock = r.activeLock;
  if (!lock) {
    // Per RFC 4918 §15.8, an empty lockdiscovery is the answer for "no
    // active lock". Always emit the element so clients have a
    // consistent shape.
    return '<D:lockdiscovery/>';
  }
  // Owner: the stored ownerXml is opaque client-provided markup; we
  // preserve it verbatim inside <D:owner>. Lock parsing already caps
  // ownerXml size and (in phase C.1) sanitizes it for XXE / DOCTYPE.
  const ownerBlock =
    lock.ownerXml.trim().length > 0
      ? `<D:owner>${lock.ownerXml}</D:owner>`
      : '';
  const rootHref = escapeXml(lock.lockRootHref ?? r.href);
  return `<D:lockdiscovery>
        <D:activelock>
          <D:locktype><D:write/></D:locktype>
          <D:lockscope><D:${lock.scope}/></D:lockscope>
          <D:depth>${lock.depth}</D:depth>
          ${ownerBlock}
          <D:timeout>Second-${Math.max(0, Math.floor(lock.timeoutSeconds))}</D:timeout>
          <D:locktoken><D:href>opaquelocktoken:${lock.lockToken}</D:href></D:locktoken>
          <D:lockroot><D:href>${rootHref}</D:href></D:lockroot>
        </D:activelock>
      </D:lockdiscovery>`;
}

function renderEmptyProp(name: string): string {
  // Defensive: name comes from the client's request XML — escape just
  // in case a malformed parser pass let something weird through. We
  // never emit attributes here, just `<D:name/>`.
  const safe = name.replace(/[^a-zA-Z0-9_:-]/g, '');
  if (safe.length === 0) return '';
  return `<D:${safe}/>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
