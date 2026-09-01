import { anyRefs } from '../../shared/handlers/function-refs';
import { checkResourceLock } from '../locks';
import { buildDavPath } from '../paths';
import {
  WEBDAV_MAX_XML_BODY,
  type AuthContext,
  type ParsedPath,
  type WebDAVCtx,
  type WebDAVRequest,
  type WebDAVResponse,
} from '../types';
import { escapeXml } from '../xml/escape';
import { createWebdavXmlParser, isRecord, pick } from '../xml/parse';

// v1 dead-prop policy: store nothing, but echo a per-prop 200 OK for
// non-live props the client tried to set. This is the "lying-200"
// pattern. Finder uses PROPPATCH to set color tags / hidden flags /
// last-printed timestamps; failing the whole request would derail PUT
// chains that wrap save+set-mtime+set-attrs into one round trip.
//
// We DO distinguish live (server-computed) properties: those return
// 403 + `<D:cannot-modify-protected-property/>` per RFC 4918 §15.
// Persisting dead props is a followup (would need a webdavProperties
// table) — H.5 documents this.

const LIVE_PROPS = new Set<string>([
  'getetag',
  'getlastmodified',
  'getcontentlength',
  'getcontenttype',
  'resourcetype',
  'creationdate',
  'lockdiscovery',
  'supportedlock',
]);

const proppatchParser = createWebdavXmlParser();

export async function handleProppatch(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }

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

  const lockResult = await checkResourceLock(req, ctx, auth, parsed);
  if (!lockResult.ok) {
    return {
      status: lockResult.status,
      headers: lockResult.headers,
      body: lockResult.body,
    };
  }

  const bodyText = await req.readText(WEBDAV_MAX_XML_BODY);
  const propNames = extractPropNames(bodyText);

  const liveProps: string[] = [];
  const deadProps: string[] = [];
  for (const name of propNames) {
    const lower = name.toLowerCase();
    if (LIVE_PROPS.has(lower)) {
      liveProps.push(name);
    } else {
      deadProps.push(name);
    }
  }

  const href = buildDavPath({
    orgSlug: auth.orgSlug,
    namespace: parsed.namespace,
    segments: parsed.segments,
    isCollection: parsed.isCollection,
  });

  const propstats: string[] = [];

  // RFC 4918 §9.2: PROPPATCH is atomic — if ANY instruction fails, none are
  // applied and the others MUST report 424 Failed Dependency. So when a
  // protected (live) prop forces a 403, the dead props that would otherwise
  // have been accepted report 424 instead of 200. (We persist nothing either
  // way, so "nothing applied" already holds.)
  if (deadProps.length > 0) {
    const status =
      liveProps.length > 0
        ? 'HTTP/1.1 424 Failed Dependency'
        : 'HTTP/1.1 200 OK';
    propstats.push(
      `    <D:propstat>
      <D:prop>${deadProps.map((p) => `<D:${escapeXml(p)}/>`).join('')}</D:prop>
      <D:status>${status}</D:status>
    </D:propstat>`,
    );
  }

  if (liveProps.length > 0) {
    // RFC 4918 §15: live properties are server-computed. Emitting
    // `<D:error><D:cannot-modify-protected-property/></D:error>`
    // inside the propstat lets the client surface a structured reason
    // rather than scraping the freeform description.
    propstats.push(
      `    <D:propstat>
      <D:prop>${liveProps.map((p) => `<D:${escapeXml(p)}/>`).join('')}</D:prop>
      <D:status>HTTP/1.1 403 Forbidden</D:status>
      <D:error><D:cannot-modify-protected-property/></D:error>
    </D:propstat>`,
    );
  }

  // If the request body contained NO prop names (malformed or empty),
  // emit a single 200-with-empty-prop response. Mirrors the prior
  // behavior so a no-op PROPPATCH stays a no-op.
  if (propstats.length === 0) {
    propstats.push(
      `    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>`,
    );
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(href)}</D:href>
${propstats.join('\n')}
  </D:response>
</D:multistatus>`;

  return {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  };
}

// Extract the names of properties under any `<D:set><D:prop>…</D:prop>`
// or `<D:remove><D:prop>…</D:prop>` block. fast-xml-parser strips
// namespace prefixes so we look for `propertyupdate` → set|remove → prop.
function extractPropNames(body: string): string[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = proppatchParser.parse(trimmed);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  const root = pick(parsed, 'propertyupdate') ?? pick(parsed, 'propertyUpdate');
  if (!isRecord(root)) return [];

  const out = new Set<string>();
  for (const sectionKey of ['set', 'remove']) {
    const section = pick(root, sectionKey);
    const sections = Array.isArray(section)
      ? section
      : section
        ? [section]
        : [];
    for (const s of sections) {
      if (!isRecord(s)) continue;
      const prop = pick(s, 'prop');
      if (!isRecord(prop)) continue;
      for (const key of Object.keys(prop)) {
        out.add(key);
      }
    }
  }
  return Array.from(out);
}
