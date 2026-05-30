// Shared XML emission helpers for the WebDAV response builders. These
// were previously copy-pasted into lock-response.ts, propfind-response.ts,
// error-body.ts and methods/proppatch.ts; a single source guarantees the
// escaping rules can't drift between emitters (the divergence that let a
// client-supplied lock owner break PROPFIND well-formedness).

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrap stored ownerXml in CDATA so the (already-validated, length-capped)
// blob round-trips back to the client without us having to re-escape every
// `<D:href>` / `<a:thing>` inside. CDATA terminator `]]>` is the only
// sequence that can break out — we neutralize it by splitting:
//   "]]>" → "]]" + "]]><![CDATA[" + ">"
// RFC 4918 §14.17 defines `<!ELEMENT owner ANY>` and §4.3 requires servers
// preserve the client's owner content; real clients (rclone, Cyberduck,
// Office) read it with a generic XML parser that handles CDATA transparently.
// MUST be used by BOTH the LOCK response and the PROPFIND lockdiscovery
// emitter — emitting ownerXml raw makes the whole multistatus non-well-formed
// on a bare `&`/`<` and enables element injection.
export function safeOwnerEmit(stored: string): string {
  if (stored.trim().length === 0) return '';
  const cleaned = stored.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<D:owner><![CDATA[${cleaned}]]></D:owner>`;
}
