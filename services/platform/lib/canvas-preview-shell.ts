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
// server.ts. The high-frequency demo libraries the LLM reaches for
// (reveal.js, Chart.js, D3, Tailwind Play, GSAP) are vendored under
// `public/canvas-libs/` and reachable via `'self'`. Operators who need
// arbitrary external CDNs can opt in with `CANVAS_PREVIEW_CSP_EXTRA_ORIGINS`
// — the third opt-in exception alongside Sentry and Figma MCP. Each
// supplied entry is validated to be a bare origin (no path/query/fragment,
// http or https only) before being appended; malformed entries are
// dropped with a warning.
export function buildCanvasPreviewCsp(
  extraOrigins: readonly string[] = [],
): string {
  const validatedExtras = extraOrigins
    .map(validateExtraOrigin)
    .filter((o): o is string => o !== null);
  const extras =
    validatedExtras.length > 0 ? ' ' + validatedExtras.join(' ') : '';
  return (
    "default-src 'self' data: blob:; " +
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${extras}; ` +
    `style-src 'self' 'unsafe-inline'${extras}; ` +
    `img-src 'self' data: blob:${extras}; ` +
    `font-src 'self' data:${extras}; ` +
    `connect-src 'self'${extras}; ` +
    "frame-ancestors 'self'; " +
    // No `form-action` directive: 'self' here means the iframe's opaque
    // origin (since sandbox runs without `allow-same-origin`), which
    // matches nothing — so any form in user HTML would be blocked. The
    // sandbox + opaque-origin combo already prevents meaningful
    // cross-origin form submissions, so this directive is just collateral.
    "base-uri 'none'; " +
    "object-src 'none'"
  );
}

// Accept exactly `https://host[:port]` or `http://host[:port]` — `URL`
// considers e.g. `https://cdn.example.com/path` a valid URL but its
// `.origin` would be `https://cdn.example.com`, so equality with the
// input is the strictest "this is just an origin" check.
function validateExtraOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      console.warn(
        `CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: dropping non-http(s) entry: ${trimmed}`,
      );
      return null;
    }
    if (url.origin !== trimmed) {
      console.warn(
        `CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: dropping entry with path/query/fragment (use bare origin): ${trimmed}`,
      );
      return null;
    }
    return url.origin;
  } catch (err) {
    console.warn(
      `CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: dropping unparseable entry "${trimmed}":`,
      err,
    );
    return null;
  }
}
