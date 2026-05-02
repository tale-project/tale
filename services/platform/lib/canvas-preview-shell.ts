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

// Runs before any <body> script. Installs an in-memory `localStorage` /
// `sessionStorage` shim on the iframe's `window` so AI-generated artifacts
// don't crash on `SecurityError: Failed to read the 'localStorage' property`
// — the iframe is sandboxed without `allow-same-origin`, so its origin is
// opaque ("null") and the platform getters throw on access. The shim is
// per-iframe-load (resets on every artifact re-render), capped at 5 MiB,
// and supports both method-style (`getItem`/`setItem`) and bracket
// (`localStorage.foo`) access via a Proxy. See plan
// `lockdown-install-js-1-ses-removing-imperative-acorn.md`.
const STORAGE_SHIM = `<script>
(function () {
  var QUOTA_BYTES = 5 * 1024 * 1024;
  function makeStorage() {
    var data = Object.create(null);
    var bytes = 0;
    function size(k, v) { return k.length + v.length; }
    var api = {
      get length() { return Object.keys(data).length; },
      key: function (i) {
        var k = Object.keys(data)[i];
        return k === undefined ? null : k;
      },
      getItem: function (k) {
        k = String(k);
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      setItem: function (k, v) {
        k = String(k); v = String(v);
        var prev = Object.prototype.hasOwnProperty.call(data, k) ? size(k, data[k]) : 0;
        var next = bytes - prev + size(k, v);
        if (next > QUOTA_BYTES) {
          var err = new Error("Quota exceeded");
          err.name = "QuotaExceededError";
          throw err;
        }
        data[k] = v; bytes = next;
      },
      removeItem: function (k) {
        k = String(k);
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          bytes -= size(k, data[k]);
          delete data[k];
        }
      },
      clear: function () {
        for (var k in data) delete data[k];
        bytes = 0;
      }
    };
    var methodNames = { length: 1, key: 1, getItem: 1, setItem: 1, removeItem: 1, clear: 1 };
    return new Proxy(api, {
      get: function (target, prop) {
        if (typeof prop === "symbol" || Object.prototype.hasOwnProperty.call(methodNames, prop)) {
          return target[prop];
        }
        return target.getItem(prop);
      },
      set: function (target, prop, value) {
        if (typeof prop === "symbol" || Object.prototype.hasOwnProperty.call(methodNames, prop)) {
          target[prop] = value;
          return true;
        }
        target.setItem(prop, value);
        return true;
      },
      has: function (target, prop) {
        if (Object.prototype.hasOwnProperty.call(methodNames, prop)) return true;
        return target.getItem(prop) !== null;
      },
      deleteProperty: function (target, prop) {
        if (Object.prototype.hasOwnProperty.call(methodNames, prop)) return false;
        target.removeItem(prop);
        return true;
      }
    });
  }
  function install(name) {
    var value = makeStorage();
    try {
      Object.defineProperty(window, name, { value: value, configurable: true });
      return;
    } catch (e1) {
      try {
        window[name] = value;
        return;
      } catch (e2) {
        var m1 = e1 && e1.message ? e1.message : String(e1);
        var m2 = e2 && e2.message ? e2.message : String(e2);
        console.warn("canvas-preview: failed to install " + name + " shim: " + m1 + " / " + m2);
      }
    }
  }
  install("localStorage");
  install("sessionStorage");
})();
</script>`;

// Listens for `{ type: 'tale:canvas:print' }` from the embedder and triggers
// the iframe's own `window.print()`. The parent cannot call `print()` on the
// iframe directly because the sandbox runs without `allow-same-origin` — the
// iframe must invoke it itself. Requires `allow-modals` on the sandbox
// attribute, since `print()` is gated on that flag.
const PRINT_LISTENER = `<script>
(function () {
  window.addEventListener('message', function (event) {
    if (event && event.data && event.data.type === 'tale:canvas:print') {
      try { window.print(); } catch (e) {
        console.warn('canvas-preview: print() failed', e);
      }
    }
  });
})();
</script>`;

const HEAD = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Canvas preview</title>
${STORAGE_SHIM}
${PRINT_LISTENER}
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
