// LOCK response body (200/201). Mirrors the active-lock structure RFC
// 4918 §14.16 requires, including the lockdiscovery wrapper.

export interface LockResponseInput {
  scope: 'exclusive' | 'shared';
  ownerXml: string;
  depth: '0' | 'infinity';
  timeoutSeconds: number;
  lockToken: string; // UUID — we wrap as opaquelocktoken: on emit
  href: string;
}

export function buildLockResponse(input: LockResponseInput): string {
  const owner = safeOwnerEmit(input.ownerXml);
  return `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:${input.scope}/></D:lockscope>
      <D:depth>${input.depth}</D:depth>
      ${owner}
      <D:timeout>Second-${input.timeoutSeconds}</D:timeout>
      <D:locktoken><D:href>opaquelocktoken:${input.lockToken}</D:href></D:locktoken>
      <D:lockroot><D:href>${escapeXml(input.href)}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
}

// Wrap stored ownerXml in CDATA so the (already-validated, length-capped)
// blob round-trips back to the client without us having to re-escape
// every `<D:href>` / `<a:thing>` inside. CDATA terminator `]]>` is the
// only sequence that can break out — we neutralize it by splitting:
//   "]]>" → "]]" + "]]><![CDATA[" + ">"
// RFC 4918 doesn't mandate any particular shape inside `<D:owner>`; the
// spec says servers MUST preserve the client's owner content "as is",
// and real clients (rclone, Cyberduck, Office) read it with a generic
// XML parser that handles CDATA transparently.
export function safeOwnerEmit(stored: string): string {
  if (stored.trim().length === 0) return '';
  const cleaned = stored.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<D:owner><![CDATA[${cleaned}]]></D:owner>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
