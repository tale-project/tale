/**
 * The `Content-Disposition` of a download, RFC 6266: an ASCII `filename`
 * for clients that read only that, and the exact name as `filename*`
 * (RFC 8187 `UTF-8''` percent-encoding, the `attr-char` set honoured, so
 * `!'()*` are encoded too). Control characters can never splice into the
 * header; a blank name downloads as `download`.
 *
 * Layer A — no imports: the object store's presign, the WebDAV GET and the
 * REST file lane all name their downloads through this one builder.
 */
export function attachmentDisposition(filename: string): string {
  const name =
    // oxlint-disable-next-line no-control-regex -- stripping control chars is the point
    filename.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'download';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
