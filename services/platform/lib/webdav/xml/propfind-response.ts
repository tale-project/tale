// Build a 207 Multi-Status body for PROPFIND. The set of live properties
// we emit is fixed (the v1 plan property list). Dead properties aren't
// stored, so PROPPATCH is a no-op success and PROPFIND never has dead
// props to return.

export interface ResourceProps {
  href: string;
  isCollection: boolean;
  displayName: string;
  contentType?: string | null;
  contentLength?: number | null;
  lastModified: Date; // RFC 1123 format
  creationDate: Date; // ISO-8601
  etag?: string | null;
}

export function buildMultiStatus(resources: ResourceProps[]): string {
  const responses = resources.map(renderResponse).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
}

function renderResponse(r: ResourceProps): string {
  const resourceType = r.isCollection ? '<D:collection/>' : '';
  const contentLength =
    !r.isCollection && r.contentLength !== undefined && r.contentLength !== null
      ? `<D:getcontentlength>${r.contentLength}</D:getcontentlength>`
      : '';
  const contentType =
    !r.isCollection && r.contentType
      ? `<D:getcontenttype>${escapeXml(r.contentType)}</D:getcontenttype>`
      : '';
  const etag = r.etag ? `<D:getetag>"${escapeXml(r.etag)}"</D:getetag>` : '';

  return `<D:response>
  <D:href>${escapeXml(r.href)}</D:href>
  <D:propstat>
    <D:prop>
      <D:resourcetype>${resourceType}</D:resourcetype>
      <D:displayname>${escapeXml(r.displayName)}</D:displayname>
      <D:getlastmodified>${escapeXml(r.lastModified.toUTCString())}</D:getlastmodified>
      <D:creationdate>${escapeXml(r.creationDate.toISOString())}</D:creationdate>
      ${contentLength}
      ${contentType}
      ${etag}
      <D:supportedlock>
        <D:lockentry>
          <D:lockscope><D:exclusive/></D:lockscope>
          <D:locktype><D:write/></D:locktype>
        </D:lockentry>
      </D:supportedlock>
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
</D:response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
