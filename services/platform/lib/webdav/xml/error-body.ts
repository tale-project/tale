// RFC 4918 §8.7 / §16: structured error bodies use the `<D:error>`
// envelope with a precondition / postcondition child element. Clients
// (rclone, davfs2, NextCloud, Cyberduck) parse this to surface useful
// messages instead of opaque "Operation failed".
//
// Common preconditions we emit:
//   - lock-token-submitted: 423 LOCKED — write requires the existing
//     lock token in the If: header; the response carries `<D:href>` to
//     the locked root so clients can re-discover lockdiscovery.
//   - no-conflicting-lock: 423 LOCKED — fresh LOCK racing against an
//     existing exclusive lock on the same path.
//   - cannot-modify-protected-property: 403 — PROPPATCH on a live prop
//     (getetag, getcontentlength, ...).
//   - propfind-finite-depth: 403 — PROPFIND Depth: infinity refused.

export interface DavErrorOptions {
  precondition: string;
  hrefs?: string[];
}

export function buildDavError(options: DavErrorOptions): string {
  const { precondition, hrefs } = options;
  const inner =
    hrefs && hrefs.length > 0
      ? `<D:${precondition}>${hrefs
          .map((h) => `<D:href>${escapeXml(h)}</D:href>`)
          .join('')}</D:${precondition}>`
      : `<D:${precondition}/>`;
  return `<?xml version="1.0" encoding="utf-8"?><D:error xmlns:D="DAV:">${inner}</D:error>`;
}

export const DAV_ERROR_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
} as const;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
