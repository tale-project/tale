// Canvas HTML preview helpers, shared by the production Hono route and the
// dev-mode Vite middleware. The route accepts a POST with the user-supplied
// HTML and echoes it back as a full document carrying the permissive CSP
// header below — escaping the SPA's strict nonce-based CSP for AI demos.
//
// Why POST + iframe navigation (not srcdoc / postMessage):
// - srcdoc / about: / blob: / data: are "local schemes" that INHERIT the
//   embedder's CSP and `<meta>` CSP can only tighten — strict nonce-based
//   policy still blocks `<script>` and `onclick=`.
// - postMessage + `document.open(); document.write()` lets scripts run, but
//   `document.open()` resets the DOM ONLY — the JS realm (Window globals,
//   top-level `let`/`const`) persists, so a user-script `const ALGORITHMS`
//   on render N collides on render N+1.
// - A fresh iframe navigation, on the other hand, gives a fresh Document
//   AND a fresh realm. Form POST is the simplest way to get one without
//   shipping huge HTML through the URL bar.

const HEAD = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Canvas preview</title>
</head>
<body>`;

const TAIL = `</body>
</html>`;

export function wrapCanvasPreviewHtml(userHtml: string): string {
  return HEAD + userHtml + TAIL;
}

// Permissive CSP for the iframe response: AI HTML needs `unsafe-inline` +
// `unsafe-eval`, but external egress (`connect-src`, external script
// hosts) is locked to `'self'` per the air-gap policy comment in
// server.ts. Cross-origin demo libraries (D3, Chart.js etc) are blocked
// by design; revisit if operators ask.
export const CANVAS_PREVIEW_CSP =
  "default-src 'self' data: blob:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'self'; " +
  // No `form-action` directive: 'self' here means the iframe's opaque
  // origin (since sandbox runs without `allow-same-origin`), which
  // matches nothing — so any form in user HTML would be blocked. The
  // sandbox + opaque-origin combo already prevents meaningful
  // cross-origin form submissions, so this directive is just collateral.
  "base-uri 'none'; " +
  "object-src 'none'";
