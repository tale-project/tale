// A local page server for browser tests (port of `tests/helpers/pages.py`): the
// fingerprint probe, a blank storage page, a form, a location probe, a tall
// page, a slow page, and a few pages to use through the live view.
//
// Firefox never proxies loopback addresses, so a test that wants its traffic
// to go through the session's proxy loads these pages under a made-up host
// name that the test proxy routes here (`url(path, 'probe.test')`).

import { createServer } from 'node:http';
import type { Server } from 'node:http';

import type { Page } from 'playwright-core';

import { isRecord } from '../../lib/is-record.ts';

/** How long /slow.html takes to answer. */
export const SLOW_MS = 6000;

const HTML = 'text/html; charset=utf-8';
const JAVASCRIPT = 'text/javascript; charset=utf-8';

// The probe runs as a normal page script (main world). Playwright's
// page.evaluate() runs in Camoufox's isolated world, where WebGL readPixels
// and AudioBuffer data throw.
const PROBE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head>
<body><pre id="fp-result"></pre>
<script src="/probe.js"></script>
<script>
window.addEventListener('load', async () => {
  const el = document.getElementById('fp-result');
  try { el.textContent = JSON.stringify(await window.__fpProbe()); }
  catch (e) { el.textContent = JSON.stringify({ fatal: String(e) }); }
  el.dataset.done = '1';
});
</script></body></html>`;

const STORAGE_HTML =
  "<!doctype html><html><head><meta charset='utf-8'><title>storage</title></head><body></body></html>";

// A page to use through the live view: fields, a list, buttons and a dialog;
// what happens shows in #log.
const FORM_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>form</title></head>
<body style="font: 20px sans-serif; margin: 20px">
<input id="name" style="font-size: 20px; width: 300px" placeholder="name">
<select id="country" style="font-size: 20px"><option value="ch">Switzerland</option><option value="de">Germany</option>
<option value="fr">France</option></select>
<button id="go" style="font-size: 20px" onclick="log('clicked')">Go</button>
<button id="ask" style="font-size: 20px" onclick="log('confirm=' + confirm('Sure?'))">Ask</button>
<p id="log"></p>
<script>
const log = text => { document.getElementById('log').textContent += text + ';'; };
document.getElementById('name').addEventListener('input', e => log('name=' + e.target.value));
document.getElementById('country').addEventListener('change', e => log('country=' + e.target.value));
</script></body></html>`;

// All three kinds of dialog; what the page got back shows in #log.
const DIALOGS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>dialogs</title></head>
<body style="font: 20px sans-serif; margin: 20px">
<button id="alert" style="font-size: 20px" onclick="alert('Heads up'); log('alerted')">Alert</button>
<button id="confirm" style="font-size: 20px" onclick="log('confirm=' + confirm('Sure?'))">Confirm</button>
<button id="prompt" style="font-size: 20px" onclick="log('prompt=' + prompt('Name?', 'Ann'))">Prompt</button>
<p id="log"></p>
<script>
const log = text => { document.getElementById('log').textContent += text + ';'; };
</script></body></html>`;

// Lists: the ones the browser draws outside the page (a single choice) and
// the ones it draws inside (several choices, a box, a list that is off).
const LISTS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>lists</title></head>
<body style="font: 20px sans-serif; margin: 20px">
<p><select id="single" style="font-size: 20px"><option>Alpha</option>
<optgroup label="Group"><option>Beta</option><option disabled>Gamma</option></optgroup></select></p>
<p><select id="multiple" multiple style="font-size: 20px"><option>One</option><option>Two</option></select></p>
<p><select id="box" size="3" style="font-size: 20px"><option>Red</option><option>Green</option><option>Blue</option></select></p>
<p><select id="off" disabled style="font-size: 20px"><option>Locked</option></select></p>
<p id="log"></p>
<script>
for (const select of document.querySelectorAll('select')) {
  select.addEventListener('change', () => { document.getElementById('log').textContent += select.id + '=' + select.value + ';'; });
}
</script></body></html>`;

// Pages that open pages.
const LINKS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>links</title></head>
<body style="font: 30px sans-serif; margin: 20px">
<p><a id="blank" href="/storage.html" target="_blank">Storage in a new tab</a></p>
<p><button id="popup" style="font-size: 30px" onclick="window.open('/form.html')">Popup</button></p>
</body></html>`;

// What an assistant reads: a heading and text, a link, fields of several
// kinds, a button that is off, a div that works as a button, a hidden field,
// and a button far below the first screen.
const READ_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>read</title></head>
<body style="font: 20px sans-serif; margin: 20px">
<h1>Reading test</h1>
<p>Some text in a paragraph.</p>
<p><a id="link" href="/storage.html">A link</a></p>
<p><label for="email">Email address</label> <input id="email" type="email" value="a@b.c"></p>
<p><input id="pw" type="password" placeholder="Password" value="secret"></p>
<p><input id="agree" type="checkbox" checked> <label for="agree">I agree</label></p>
<p><input id="hidden" type="hidden" value="x"></p>
<p><button id="off" disabled>Disabled button</button></p>
<p><textarea id="notes" placeholder="Notes"></textarea></p>
<div id="fake" role="button" tabindex="0">Div button</div>
<p><select id="size" aria-label="Size"><option>S</option><option selected>M</option><option>L</option></select></p>
<div style="height: 4000px"></div>
<button id="far">Far away</button>
</body></html>`;

// What a site can learn about where the visitor is: time zone, languages,
// geolocation (it needs a secure context: load it from 127.0.0.1) and the
// addresses that WebRTC offers.
const GEO_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>geo</title></head><body><pre id="out"></pre>
<script>
(async () => {
  const out = {};
  const options = Intl.DateTimeFormat().resolvedOptions();
  out.timeZone = options.timeZone;
  out.tzOffset = new Date(2024, 0, 1).getTimezoneOffset();
  out.language = navigator.language;
  out.languages = Array.from(navigator.languages);
  out.permission = (await navigator.permissions.query({name: 'geolocation'})).state;
  out.position = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy}),
    (e) => resolve({error: e.code + ': ' + e.message}), {timeout: 8000}));
  const candidates = [];
  const connection = new RTCPeerConnection({iceServers: []});
  connection.onicecandidate = (event) => { if (event.candidate) candidates.push(event.candidate.candidate); };
  connection.createDataChannel('probe');
  await connection.setLocalDescription(await connection.createOffer());
  await new Promise((resolve) => setTimeout(resolve, 2000));
  out.webrtc = candidates;
  connection.close();
  document.getElementById('out').textContent = JSON.stringify(out);
  document.getElementById('out').dataset.done = '1';
})();
</script></body></html>`;

// A tall page whose every screenful looks different, to scroll through.
const LONG_HTML = `<!doctype html><html><head><meta charset='utf-8'><title>long</title></head><body style='margin:0'>${Array.from(
  { length: 400 },
  (_, row) =>
    `<div style='height:200px;font:80px sans-serif;background:hsl(${(row * 7) % 360},70%,60%)'>row ${row}</div>`,
).join('')}</body></html>`;

interface TestPage {
  body: string;
  type: string;
}

function pages(): Map<string, TestPage> {
  return new Map<string, TestPage>([
    ['/probe.html', { body: PROBE_HTML, type: HTML }],
    ['/probe.js', { body: PROBE_SCRIPT, type: JAVASCRIPT }],
    ['/storage.html', { body: STORAGE_HTML, type: HTML }],
    ['/form.html', { body: FORM_HTML, type: HTML }],
    ['/dialogs.html', { body: DIALOGS_HTML, type: HTML }],
    ['/lists.html', { body: LISTS_HTML, type: HTML }],
    ['/links.html', { body: LINKS_HTML, type: HTML }],
    ['/read.html', { body: READ_HTML, type: HTML }],
    ['/geo.html', { body: GEO_HTML, type: HTML }],
    ['/long.html', { body: LONG_HTML, type: HTML }],
    // Answers only after SLOW_MS.
    ['/slow.html', { body: STORAGE_HTML, type: HTML }],
  ]);
}

export interface TestPages {
  /** The port on 127.0.0.1. */
  readonly port: number;
  /** The address of a page; under another host name if the test proxy routes it here. */
  url(path: string, host?: string): string;
  /** Stop serving. Pages that are still waiting for their answer are dropped. */
  close(): Promise<void>;
}

/** Serve the test pages on a free port of 127.0.0.1. */
export async function startTestPages(
  options: { slowMs?: number } = {},
): Promise<TestPages> {
  const served = pages();
  const slowMs = options.slowMs ?? SLOW_MS;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?', 1)[0] ?? '/';
    const page = served.get(path);
    if (page === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    const respond = (): void => {
      response.writeHead(200, {
        'Content-Type': page.type,
        'Content-Length': Buffer.byteLength(page.body),
        'Cache-Control': 'no-store',
      });
      response.end(page.body);
    };
    if (path !== '/slow.html') {
      respond();
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      respond();
    }, slowMs);
    timers.add(timer);
    response.on('close', () => {
      clearTimeout(timer);
      timers.delete(timer);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test pages have no port');
  }
  const { port } = address;
  return {
    port,
    url: (path, host = '127.0.0.1') => `http://${host}:${port}${path}`,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.closeAllConnections();
      // Bun stops listening with the connections.
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

/** What /probe.html (loaded from `url`) found out about the browser. */
export async function runProbe(
  page: Page,
  url: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  await page.goto(url, { timeout: timeoutMs });
  await page.waitForSelector('#fp-result[data-done="1"]', {
    state: 'attached',
    timeout: timeoutMs,
  });
  const result: unknown = JSON.parse(
    (await page.textContent('#fp-result')) ?? '{}',
  );
  if (!isRecord(result))
    throw new Error(`${url} did not answer with an object`);
  return result;
}

// -- the fingerprint probe ----------------------------------------------------------
//
// Served as /probe.js: it sets `window.__fpProbe` to ONE async function that
// returns a JSON-serialisable object. /probe.html runs it when the page has
// loaded and writes the JSON into <pre id="fp-result" data-done="1">, which
// the test reads.
//
// It runs in the PAGE's main world, as a real fingerprinting script would. Do
// NOT use plain page.evaluate() with Camoufox: Playwright's evaluate runs in
// Camoufox's isolated world (Xray wrappers), where WebGL readPixels and
// AudioBuffer.getChannelData throw "Accessing TypedArray data over Xrays is
// slow, and forbidden". (page.evaluate("mw:" + script) works only when the
// browser was launched with main_world_eval.)
// Needs a real origin (http://127.0.0.1:<port>/...) so crypto.subtle, storage
// and enumerateDevices behave as on a real site.
//
// It is a string, not a file, so that the page server needs nothing from disk
// and no tool reads it as code of the service (it holds no backtick, and
// `String.raw` leaves its escapes as they are).
const PROBE_SCRIPT = String.raw`window.__fpProbe = async () => {
  const out = { errors: {} };
  const enc = new TextEncoder();

  // ---------- SHA-256 (crypto.subtle, with pure-JS fallback for insecure origins)
  function sha256Fallback(bytes) {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ]);
    const l = bytes.length,
      bitLen = l * 8;
    const n = (((l + 9) >> 6) + 1) << 6;
    const m = new Uint8Array(n);
    m.set(bytes);
    m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, bitLen >>> 0);
    dv.setUint32(n - 8, Math.floor(bitLen / 4294967296));
    const W = new Uint32Array(64);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let off = 0; off < n; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 =
          (h +
            (r(e, 6) ^ r(e, 11) ^ r(e, 25)) +
            ((e & f) ^ (~e & g)) +
            K[i] +
            W[i]) >>>
          0;
        const t2 =
          ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>>
          0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] += a;
      H[1] += b;
      H[2] += c;
      H[3] += d;
      H[4] += e;
      H[5] += f;
      H[6] += g;
      H[7] += h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
  }
  async function sha256(data) {
    const bytes =
      typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
    try {
      if (globalThis.crypto && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(d), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
      }
    } catch {
      /* fall through to the pure-JS digest */
    }
    return sha256Fallback(bytes);
  }
  // Canonical JSON (sorted keys) so the combined hash is order-independent.
  function canon(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canon(v[k]))
        .join(',') +
      '}'
    );
  }
  async function safe(name, fn) {
    try {
      return await fn();
    } catch (e) {
      out.errors[name] = String((e && e.message) || e);
      return null;
    }
  }
  const withTimeout = (p, ms, fallback) =>
    Promise.race([
      p,
      new Promise((res) => setTimeout(() => res(fallback), ms)),
    ]);

  // ---------- navigator
  out.navigator = await safe('navigator', () => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    oscpu: navigator.oscpu === undefined ? null : navigator.oscpu,
    appVersion: navigator.appVersion,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory:
      navigator.deviceMemory === undefined ? null : navigator.deviceMemory,
    language: navigator.language,
    languages: Array.from(navigator.languages || []),
    maxTouchPoints: navigator.maxTouchPoints,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl:
      navigator.globalPrivacyControl === undefined
        ? null
        : navigator.globalPrivacyControl,
    webdriver: navigator.webdriver,
    cookieEnabled: navigator.cookieEnabled,
    pdfViewerEnabled:
      navigator.pdfViewerEnabled === undefined
        ? null
        : navigator.pdfViewerEnabled,
    pluginsLength: navigator.plugins ? navigator.plugins.length : null,
    plugins: navigator.plugins
      ? Array.from(navigator.plugins, (p) => p.name)
      : [],
    mimeTypesLength: navigator.mimeTypes ? navigator.mimeTypes.length : null,
    buildID: navigator.buildID === undefined ? null : navigator.buildID,
  }));

  // ---------- Intl / time
  out.intl = await safe('intl', () => {
    const ro = Intl.DateTimeFormat().resolvedOptions();
    return {
      timeZone: ro.timeZone,
      locale: ro.locale,
      calendar: ro.calendar,
      numberingSystem: ro.numberingSystem,
      // Fixed dates so the value is stable across runs (not "now")
      tzOffsetJan: new Date(2024, 0, 1).getTimezoneOffset(),
      tzOffsetJul: new Date(2024, 6, 1).getTimezoneOffset(),
      numberFormat: new Intl.NumberFormat().format(1234567.891),
      dateString: new Date(Date.UTC(2024, 0, 2, 3, 4, 5)).toString(),
    };
  });

  // ---------- screen / window
  out.screen = await safe('screen', () => ({
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    availLeft: screen.availLeft === undefined ? null : screen.availLeft,
    availTop: screen.availTop === undefined ? null : screen.availTop,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    orientation: screen.orientation ? screen.orientation.type : null,
  }));
  out.window = await safe('window', () => ({
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
  }));
  out.media = await safe('mediaQueries', () => ({
    prefersColorScheme: matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    pointerFine: matchMedia('(pointer: fine)').matches,
    hover: matchMedia('(hover: hover)').matches,
  }));

  // ---------- WebGL
  async function webglInfo(kind) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const gl = c.getContext(kind, { preserveDrawingBuffer: true });
    if (!gl) return { supported: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const P = [
      'ALIASED_LINE_WIDTH_RANGE',
      'ALIASED_POINT_SIZE_RANGE',
      'ALPHA_BITS',
      'BLUE_BITS',
      'DEPTH_BITS',
      'GREEN_BITS',
      'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
      'MAX_CUBE_MAP_TEXTURE_SIZE',
      'MAX_FRAGMENT_UNIFORM_VECTORS',
      'MAX_RENDERBUFFER_SIZE',
      'MAX_TEXTURE_IMAGE_UNITS',
      'MAX_TEXTURE_SIZE',
      'MAX_VARYING_VECTORS',
      'MAX_VERTEX_ATTRIBS',
      'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
      'MAX_VERTEX_UNIFORM_VECTORS',
      'MAX_VIEWPORT_DIMS',
      'RED_BITS',
      'RENDERER',
      'SHADING_LANGUAGE_VERSION',
      'STENCIL_BITS',
      'SUBPIXEL_BITS',
      'VENDOR',
      'VERSION',
      // WebGL2-only (null on WebGL1)
      'MAX_3D_TEXTURE_SIZE',
      'MAX_ARRAY_TEXTURE_LAYERS',
      'MAX_COLOR_ATTACHMENTS',
      'MAX_DRAW_BUFFERS',
      'MAX_ELEMENTS_INDICES',
      'MAX_ELEMENTS_VERTICES',
      'MAX_FRAGMENT_UNIFORM_COMPONENTS',
      'MAX_SAMPLES',
      'MAX_UNIFORM_BLOCK_SIZE',
      'MAX_UNIFORM_BUFFER_BINDINGS',
      'MAX_VARYING_COMPONENTS',
      'MAX_VERTEX_UNIFORM_COMPONENTS',
      'MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS',
    ];
    const params = {};
    for (const p of P) {
      if (gl[p] === undefined) continue;
      let v = null;
      try {
        v = gl.getParameter(gl[p]);
      } catch {
        v = 'ERR';
      }
      if (v && typeof v === 'object' && 'length' in v) v = Array.from(v);
      params[p] = v === undefined ? null : v;
    }
    const prec = {};
    for (const sh of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
      for (const pt of [
        'LOW_FLOAT',
        'MEDIUM_FLOAT',
        'HIGH_FLOAT',
        'LOW_INT',
        'MEDIUM_INT',
        'HIGH_INT',
      ]) {
        try {
          const f = gl.getShaderPrecisionFormat(gl[sh], gl[pt]);
          prec[sh + '.' + pt] = f
            ? [f.rangeMin, f.rangeMax, f.precision]
            : null;
        } catch {
          prec[sh + '.' + pt] = 'ERR';
        }
      }
    }
    const extensions = (gl.getSupportedExtensions() || []).slice().sort();
    const ctxAttrs = gl.getContextAttributes();
    // Render a small gradient triangle and hash the pixels (GPU rendering FP).
    let renderHash = null;
    try {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(
        vs,
        'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.0,1.0);}',
      );
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(
        fs,
        'precision mediump float;varying vec2 v;void main(){gl_FragColor=vec4(v*0.5+0.5,sin(v.x*v.y*13.7),1.0);}',
      );
      gl.compileShader(fs);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs);
      gl.attachShader(pr, fs);
      gl.linkProgram(pr);
      gl.useProgram(pr);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-0.9, -0.8, 0.85, -0.6, 0.1, 0.95]),
        gl.STATIC_DRAW,
      );
      const loc = gl.getAttribLocation(pr, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.clearColor(0.1, 0.2, 0.3, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(64 * 64 * 4);
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
      renderHash = await sha256(px);
    } catch (e) {
      renderHash = 'ERR:' + e;
    }
    const info = {
      supported: true,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : null,
      extensionCount: extensions.length,
      renderHash,
    };
    info.paramsHash = await sha256(
      canon({ params, prec, extensions, ctxAttrs }),
    );
    info.params = params;
    info.extensions = extensions;
    return info;
  }
  out.webgl = await safe('webgl', () => webglInfo('webgl'));
  out.webgl2 = await safe('webgl2', () => webglInfo('webgl2'));

  // ---------- Canvas 2D
  out.canvas = await safe('canvas', async () => {
    const c = document.createElement('canvas');
    c.width = 280;
    c.height = 80;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Cwm fjordbank glyphs vext quiz, \u{1F603}', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.font = '18pt Times New Roman';
    ctx.fillText('Cwm fjordbank glyphs vext quiz, \u{1F603}', 4, 45);
    ctx.globalCompositeOperation = 'multiply';
    for (const [col, x, y] of [
      ['#f2f', 40, 40],
      ['#2ff', 80, 40],
      ['#ff2', 60, 60],
    ]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#f9c';
    ctx.arc(200, 40, 25, 0, Math.PI * 2, true);
    ctx.arc(200, 40, 12, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    const url = c.toDataURL();
    // Second, text-free shapes canvas: separates glyph rendering from geometry AA.
    const c2 = document.createElement('canvas');
    c2.width = 120;
    c2.height = 60;
    const g = c2.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 120, 60);
    grad.addColorStop(0, '#123456');
    grad.addColorStop(1, '#fedcba');
    g.fillStyle = grad;
    g.fillRect(0, 0, 120, 60);
    g.strokeStyle = 'rgba(255,0,0,0.6)';
    g.lineWidth = 3.3;
    g.beginPath();
    g.moveTo(5, 55);
    g.bezierCurveTo(30, -20, 90, 90, 115, 5);
    g.stroke();
    // Stability check: drawing the same canvas twice must give the same bytes
    // (per-read random noise would break this).
    const again = c.toDataURL();
    // Firefox's baseline fingerprinting protection (on by default, also in stock
    // Firefox) appends a random 8-byte ancillary PNG chunk 'deBG' to toDataURL()
    // output, keyed per top-level SITE and per BROWSER SESSION. So the dataURL
    // hash changes on every relaunch even though the pixels do not. Hash the raw
    // pixels too, and the PNG with that chunk stripped.
    const pngChunks = (dataUrl) => {
      const bin = atob(dataUrl.split(',')[1]);
      const types = [];
      let extra = null;
      let i = 8;
      while (i + 8 <= bin.length) {
        const len =
          ((bin.charCodeAt(i) << 24) |
            (bin.charCodeAt(i + 1) << 16) |
            (bin.charCodeAt(i + 2) << 8) |
            bin.charCodeAt(i + 3)) >>>
          0;
        const type = bin.slice(i + 4, i + 8);
        types.push(type);
        if (type === 'deBG')
          extra = {
            start: i,
            end: i + 12 + len,
            value: bin.slice(i + 8, i + 8 + len),
          };
        i += 12 + len;
      }
      return {
        types,
        extra,
        stripped: extra
          ? bin.slice(0, extra.start) + bin.slice(extra.end)
          : bin,
      };
    };
    const pc = pngChunks(url);
    const pixels = (cv) =>
      cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    return {
      hash: await sha256(url), // classic toDataURL hash (per-launch volatile in Firefox)
      shapesHash: await sha256(c2.toDataURL()),
      pngStrippedHash: await sha256(pc.stripped), // toDataURL minus the 'deBG' chunk
      pixelHash: await sha256(pixels(c)), // getImageData of text+shapes canvas
      shapesPixelHash: await sha256(pixels(c2)), // getImageData of shapes-only canvas
      pngChunkTypes: pc.types.join(','),
      deBG: pc.extra ? pc.extra.value : null,
      dataUrlLength: url.length,
      stableWithinPage: url === again,
    };
  });

  // ---------- OfflineAudioContext
  out.audio = await safe('audio', async () => {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) return { supported: false };
    const ctx = new AC(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50;
    comp.knee.value = 40;
    comp.ratio.value = 12;
    comp.attack.value = 0;
    comp.release.value = 0.25;
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    const buf = await withTimeout(ctx.startRendering(), 5000, null);
    if (!buf) return { supported: true, timeout: true };
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
    const live = window.AudioContext ? new AudioContext() : null;
    const liveInfo = live
      ? {
          sampleRate: live.sampleRate,
          maxChannelCount: live.destination.maxChannelCount,
          baseLatency: live.baseLatency === undefined ? null : live.baseLatency,
        }
      : null;
    if (live) {
      try {
        await live.close();
      } catch {
        /* closing is best effort */
      }
    }
    return {
      supported: true,
      sum: sum,
      hash: await sha256(new Uint8Array(data.buffer.slice(0))),
      live: liveInfo,
    };
  });

  // ---------- Fonts (width/height of a test string vs generic fallbacks)
  out.fonts = await safe('fonts', () => {
    const FONTS = [
      // Windows
      'Arial',
      'Arial Black',
      'Calibri',
      'Cambria',
      'Cambria Math',
      'Candara',
      'Comic Sans MS',
      'Consolas',
      'Constantia',
      'Corbel',
      'Courier New',
      'Ebrima',
      'Franklin Gothic Medium',
      'Gabriola',
      'Georgia',
      'Impact',
      'Lucida Console',
      'Lucida Sans Unicode',
      'Malgun Gothic',
      'Microsoft Sans Serif',
      'Microsoft YaHei',
      'MS Gothic',
      'Nirmala UI',
      'Palatino Linotype',
      'Segoe UI',
      'Segoe UI Emoji',
      'Segoe UI Variable',
      'Segoe Print',
      'Sylfaen',
      'Tahoma',
      'Times New Roman',
      'Trebuchet MS',
      'Verdana',
      // macOS
      'Helvetica',
      'Helvetica Neue',
      'Menlo',
      'Monaco',
      'Avenir',
      'Avenir Next',
      'Futura',
      'Geneva',
      'Gill Sans',
      'Optima',
      'Lucida Grande',
      'Apple Color Emoji',
      'Baskerville',
      'American Typewriter',
      'Didot',
      'Hoefler Text',
      'Papyrus',
      'Charter',
      'SF Pro',
      'PingFang SC',
      // Linux / web
      'Noto Sans',
      'Noto Serif',
      'DejaVu Sans',
      'DejaVu Sans Mono',
      'DejaVu Serif',
      'Liberation Sans',
      'Liberation Serif',
      'Liberation Mono',
      'Ubuntu',
      'Cantarell',
      'Arimo',
      'Cousine',
      'Tinos',
      'Roboto',
      'Open Sans',
      'Lato',
      'Fira Code',
      'Source Code Pro',
      'Twemoji Mozilla',
    ];
    const BASES = ['monospace', 'sans-serif', 'serif'];
    const TEXT = 'mmmmmmmmmmlli1WwQ@#é中';
    const ctx = document.createElement('canvas').getContext('2d');
    const measure = (font) => {
      ctx.font = '72px ' + font;
      const m = ctx.measureText(TEXT);
      return [
        m.width,
        m.actualBoundingBoxAscent,
        m.actualBoundingBoxDescent,
      ].join('/');
    };
    const base = {};
    for (const b of BASES) base[b] = measure(b);
    const available = [];
    const metrics = {};
    for (const f of FONTS) {
      let present = false;
      for (const b of BASES) {
        const v = measure('"' + f + '", ' + b);
        if (v !== base[b]) {
          present = true;
          metrics[f] = v;
          break;
        }
      }
      if (present) available.push(f);
    }
    return {
      tested: FONTS.length,
      available,
      count: available.length,
      baseMetrics: base,
      metricsHash: null,
      _metrics: metrics,
    };
  });
  if (out.fonts) {
    out.fonts.metricsHash = await sha256(canon(out.fonts._metrics));
    out.fonts.listHash = await sha256(out.fonts.available.join(','));
    delete out.fonts._metrics;
  }

  // ---------- Speech voices
  out.speech = await safe('speech', async () => {
    if (!window.speechSynthesis) return { supported: false };
    let voices = speechSynthesis.getVoices();
    if (!voices.length) {
      await withTimeout(
        new Promise((res) =>
          speechSynthesis.addEventListener('voiceschanged', res, {
            once: true,
          }),
        ),
        1500,
      );
      voices = speechSynthesis.getVoices();
    }
    const names = voices.map((v) =>
        [v.name, v.lang, v.localService ? 1 : 0, v.default ? 1 : 0].join('|'),
      );
    return {
      supported: true,
      count: voices.length,
      hash: await sha256(names.join('\n')),
      sample: names.slice(0, 3),
    };
  });

  // ---------- Media devices
  out.mediaDevices = await safe('mediaDevices', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
      return { supported: false };
    const devs = await withTimeout(
      navigator.mediaDevices.enumerateDevices(),
      3000,
      [],
    );
    const kinds = {};
    for (const d of devs) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
    return { supported: true, count: devs.length, kinds };
  });

  // ---------- Storage quota (disk-derived)
  out.storage = await safe('storage', async () => {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return { quota: e.quota };
  });

  // ---------- Combined hashes
  // combinedHash: every collected field (errors included).
  // stableHash:   same, minus fields Firefox itself randomises per browser
  //               session (canvas toDataURL output carrying the 'deBG' chunk).
  //               This is what must stay identical across relaunches of a session.
  const hashInput = {};
  for (const k of Object.keys(out))
    if (k !== 'combinedHash' && k !== 'stableHash') hashInput[k] = out[k];
  out.combinedHash = await sha256(canon(hashInput));
  const stableInput = JSON.parse(JSON.stringify(hashInput));
  if (stableInput.canvas) {
    delete stableInput.canvas.hash;
    delete stableInput.canvas.shapesHash;
    delete stableInput.canvas.deBG;
  }
  out.stableHash = await sha256(canon(stableInput));
  return out;
};
`;
