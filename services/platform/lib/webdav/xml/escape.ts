// Shared XML emission helpers for the WebDAV response builders. These
// were previously copy-pasted into lock-response.ts, propfind-response.ts,
// error-body.ts and methods/proppatch.ts; a single source guarantees the
// escaping rules can't drift between emitters (the divergence that let a
// client-supplied lock owner break PROPFIND well-formedness).

// Drop code points forbidden by the XML 1.0 Char production
//   Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
// i.e. the C0 control range EXCEPT tab/LF/CR, plus the non-characters
// U+FFFE/U+FFFF. These cannot be represented in XML at all (not as entities,
// not even inside CDATA — the Char production still applies), so a single such
// byte in a stored document/folder title would make the entire PROPFIND 207 /
// lock / error body non-well-formed and unparseable by the client. This is the
// last line of defense: paths.ts rejects them in path segments, but displayname
// / getcontenttype / href come from raw DB state and are not path-validated.
// Implemented as a char-code scan (not a control-char regex) to keep the source
// ASCII-clean and unambiguous.
function stripXmlIllegalChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      c === 0x09 || // tab
      c === 0x0a || // LF
      c === 0x0d || // CR
      (c >= 0x20 && c !== 0xfffe && c !== 0xffff)
    ) {
      out += s[i];
    }
  }
  return out;
}

export function escapeXml(s: string): string {
  return stripXmlIllegalChars(s)
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
// XML-illegal control chars are stripped first: they break well-formedness
// even inside CDATA (CDATA exempts markup, not the Char production).
// RFC 4918 §14.17 defines `<!ELEMENT owner ANY>` and §4.3 requires servers
// preserve the client's owner content; real clients (rclone, Cyberduck,
// Office) read it with a generic XML parser that handles CDATA transparently.
// MUST be used by BOTH the LOCK response and the PROPFIND lockdiscovery
// emitter — emitting ownerXml raw makes the whole multistatus non-well-formed
// on a bare `&`/`<` and enables element injection.
export function safeOwnerEmit(stored: string): string {
  if (stored.trim().length === 0) return '';
  const cleaned = stripXmlIllegalChars(stored).replace(
    /]]>/g,
    ']]]]><![CDATA[>',
  );
  return `<D:owner><![CDATA[${cleaned}]]></D:owner>`;
}
