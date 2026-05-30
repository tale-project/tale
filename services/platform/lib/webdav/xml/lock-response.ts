// LOCK response body (200/201). Mirrors the active-lock structure RFC
// 4918 §14.16 requires, including the lockdiscovery wrapper.

import { escapeXml, safeOwnerEmit } from './escape';

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
