import { buildDavPath } from '../paths';
import type { AuthContext, ParsedPath, WebDAVResponse } from '../types';

// No-op success. v1 doesn't store dead properties — clients that try to
// set custom props (Finder's "Color tags", Office's "last printed" etc.)
// get a 200 response per-prop but the values aren't persisted. RFC 4918
// allows this for properties the server elects not to support — we
// optimistically return success rather than enumerate every prop name.
export function handleProppatch(
  auth: AuthContext,
  parsed: ParsedPath,
): WebDAVResponse {
  const href = buildDavPath({
    orgSlug: auth.orgSlug,
    namespace: parsed.namespace,
    segments: parsed.segments,
    isCollection: parsed.isCollection,
  });
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
  return {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
