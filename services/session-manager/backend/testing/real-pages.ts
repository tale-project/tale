// Pages for the real-browser lane that `test-pages.ts` does not have, on a
// server that keeps a log of the requests it got:
//
//   /where.html     time zone, clock (the offsets in January and July, a date as text), languages
//   /position.html  the permission to read the position, then the position itself
//   /webrtc.html    the addresses WebRTC offers a page
//   /keys.html      what the keyboard does: a field, and a log of the keys it saw
//   /assets.html    a page that loads a script and fetches some data (both with the page's
//                   own query), then marks <body data-script data-fetched>
//   anything else   a page whose title is the last part of its path (`/p/two`: "two",
//                   `/storage.html`: "storage"); `.js` and `.json` are what /assets.html asks for
//
// Every page writes its findings as JSON into <pre id="out" data-done="1">
// (`readOut`). The log of requests is how a test sees what reached the server
// and what did not (`site.requests`); every page names an inline icon so that
// the browser does not add a request for /favicon.ico of its own.
//
//     const site = await startSite();
//     afterAll(() => site.close());
//     site.url('/where.html', 'probe.test')  // under the made-up host name of the proxies

import { createServer } from 'node:http';
import type { Server } from 'node:http';

import type { Page } from 'playwright-core';

import { isRecord } from '../../lib/is-record.ts';

/** A request the server got. */
export interface SiteRequest {
  method: string;
  /** The path with its query, as the server was asked for it. */
  path: string;
  /** The Host header: the name the browser used. */
  host: string;
}

export interface Site {
  readonly port: number;
  /** The requests the server got, in order. */
  readonly requests: SiteRequest[];
  /** The address of a page; under another host name if the test proxy routes it here. */
  url(path: string, host?: string): string;
  close(): Promise<void>;
}

const HTML = 'text/html; charset=utf-8';

const WHERE_HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>where</title></head><body><pre id="out"></pre>
<script>
(() => {
  const out = {};
  out.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  out.january = new Date(2024, 0, 1).getTimezoneOffset();
  out.july = new Date(2024, 6, 1).getTimezoneOffset();
  out.dateString = new Date(Date.UTC(2024, 0, 2, 3, 4, 5)).toString();
  out.language = navigator.language;
  out.languages = Array.from(navigator.languages);
  out.secure = isSecureContext;
  const el = document.getElementById('out');
  el.textContent = JSON.stringify(out);
  el.dataset.done = '1';
})();
</script></body></html>`;

// Geolocation needs a secure context: load it from 127.0.0.1. The permission
// is written as soon as it is known (data-stage="permission"): a browser that
// cannot ask for it leaves the request pending, and the timers of the page stop
// meanwhile, so the page cannot give up on its own.
const POSITION_HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>position</title></head><body><pre id="out"></pre>
<script>
(async () => {
  const el = document.getElementById('out');
  const out = { secure: isSecureContext };
  out.permission = (await navigator.permissions.query({ name: 'geolocation' })).state;
  el.textContent = JSON.stringify(out);
  el.dataset.stage = 'permission';
  out.position = await new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => resolve({ error: e.code + ': ' + e.message }),
      { timeout: 4000 },
    ),
  );
  el.textContent = JSON.stringify(out);
  el.dataset.done = '1';
})();
</script></body></html>`;

const WEBRTC_HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>webrtc</title></head><body><pre id="out"></pre>
<script>
(async () => {
  const out = { available: typeof RTCPeerConnection === 'function', candidates: [], sdp: '', error: null };
  if (out.available) {
    try {
      const connection = new RTCPeerConnection({ iceServers: [] });
      connection.onicecandidate = (event) => {
        if (event.candidate) out.candidates.push(event.candidate.candidate);
      };
      connection.createDataChannel('probe');
      await connection.setLocalDescription(await connection.createOffer());
      await new Promise((resolve) => setTimeout(resolve, 2000));
      out.sdp = connection.localDescription ? connection.localDescription.sdp : '';
      connection.close();
    } catch (error) {
      out.error = String(error);
    }
  }
  const el = document.getElementById('out');
  el.textContent = JSON.stringify(out);
  el.dataset.done = '1';
})();
</script></body></html>`;

// A field and a log of the keys the page saw: "key|flags" with C (control),
// S (shift), A (alt) and M (meta).
const KEYS_HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>keys</title></head>
<body style="font: 20px sans-serif; margin: 20px">
<input id="field" style="font-size: 20px; width: 300px" autofocus>
<pre id="log"></pre>
<script>
document.addEventListener('keydown', (event) => {
  const flags = (event.ctrlKey ? 'C' : '') + (event.shiftKey ? 'S' : '') + (event.altKey ? 'A' : '') + (event.metaKey ? 'M' : '');
  document.getElementById('log').textContent += event.key + '|' + flags + '\\n';
});
</script></body></html>`;

// The script and the data that /assets.html loads.
const ASSETS_HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>assets</title></head><body>
<script>
const script = document.createElement('script');
script.src = '/p/app.js' + location.search;
document.head.append(script);
fetch('/p/data.json' + location.search)
  .then((response) => response.text())
  .then((text) => { document.body.dataset.fetched = text; });
</script></body></html>`;

function plainPage(name: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>${name}</title></head><body>${name}</body></html>`;
}

interface Served {
  type: string;
  body: string;
}

function serve(path: string): Served {
  if (path.endsWith('.js')) {
    return {
      type: 'text/javascript; charset=utf-8',
      body: "document.body.dataset.script = 'ran';",
    };
  }
  if (path.endsWith('.json')) {
    return { type: 'application/json', body: '{"ok":true}' };
  }
  const pages: Record<string, string> = {
    '/where.html': WHERE_HTML,
    '/position.html': POSITION_HTML,
    '/webrtc.html': WEBRTC_HTML,
    '/keys.html': KEYS_HTML,
    '/assets.html': ASSETS_HTML,
  };
  const page = pages[path];
  if (page !== undefined) return { type: HTML, body: page };
  const name = (path.split('/').pop() ?? '').replace(/\.html$/u, '');
  // Only letters, digits, "_" and "-" reach the markup.
  return {
    type: HTML,
    body: plainPage(name.replace(/[^A-Za-z0-9_-]/gu, '')),
  };
}

/** Serve the pages on a free port of 127.0.0.1. */
export async function startSite(): Promise<Site> {
  const requests: SiteRequest[] = [];
  const server: Server = createServer((request, response) => {
    const target = request.url ?? '/';
    requests.push({
      method: request.method ?? 'GET',
      path: target,
      host: request.headers.host ?? '',
    });
    const { type, body } = serve(target.split('?', 1)[0] ?? '/');
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    response.end(body);
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
    throw new Error('the site has no port');
  }
  const { port } = address;
  return {
    port,
    requests,
    url: (path, host = '127.0.0.1') => `http://${host}:${port}${path}`,
    close: async () => {
      server.closeAllConnections();
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

/**
 * What a page of this file wrote: the JSON of `<pre id="out">`, once the page
 * said it is done (or reached `stage`, for a page that tells its findings in steps).
 */
export async function readOut(
  page: Page,
  options: { stage?: string; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const { stage, timeoutMs = 30_000 } = options;
  await page.waitForSelector(
    stage === undefined ? '#out[data-done="1"]' : `#out[data-stage="${stage}"]`,
    { state: 'attached', timeout: timeoutMs },
  );
  const found: unknown = JSON.parse((await page.textContent('#out')) ?? '{}');
  if (!isRecord(found))
    throw new Error('the page did not answer with an object');
  return found;
}
