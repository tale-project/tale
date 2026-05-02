import { describe, expect, test } from 'vitest';

import { wrapCanvasPreviewHtml } from './canvas-preview-shell';

// End-to-end check that the storage shim survives a real opaque-origin
// sandbox. The Node-side tests in `server.test.ts` cover the shim's API
// contract; this one exercises the only thing that vm-eval cannot
// reproduce — that `Object.defineProperty(window, 'localStorage', …)`
// actually shadows the throwing platform getter when the document is
// loaded with `sandbox="allow-scripts"` and no `allow-same-origin`.
//
// Communication channel: `postMessage` is one of the few APIs callable
// from an opaque-origin frame to its embedder. The in-iframe script
// posts a result object, the parent test resolves on receipt. Reading
// `iframe.contentWindow.name` would throw `SecurityError` in Chromium
// despite the HTML spec listing `name` as cross-origin-readable.
describe('canvas-preview storage shim (real opaque-origin iframe)', () => {
  async function runInSandbox(userHtml: string): Promise<unknown> {
    const wrapped = wrapCanvasPreviewHtml(userHtml);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = wrapped;

    const received = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('iframe did not post a message within 5s'));
      }, 5000);
      function onMessage(e: MessageEvent) {
        if (e.source !== iframe.contentWindow) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(e.data);
      }
      window.addEventListener('message', onMessage);
    });

    document.body.appendChild(iframe);
    try {
      return await received;
    } finally {
      iframe.remove();
    }
  }

  test('localStorage and sessionStorage are usable; no SecurityError', async () => {
    const userHtml = `<script>
      var report = { ok: false };
      try {
        localStorage.setItem('k', 'v1');
        report.localGet = localStorage.getItem('k');
        sessionStorage.setItem('s', 'v2');
        report.sessionGet = sessionStorage.getItem('s');
        // Bracket notation must round-trip through the same store.
        localStorage.foo = 'bar';
        report.bracketGet = localStorage.getItem('foo');
        // Cross-store independence.
        report.crossStore = sessionStorage.getItem('k');
        report.ok = true;
      } catch (e) {
        report.error = e && e.message ? e.message : String(e);
      }
      parent.postMessage(report, '*');
    </script>`;
    const report = (await runInSandbox(userHtml)) as Record<string, unknown>;
    expect(report.ok).toBe(true);
    expect(report.localGet).toBe('v1');
    expect(report.sessionGet).toBe('v2');
    expect(report.bracketGet).toBe('bar');
    expect(report.crossStore).toBeNull();
  });

  test('print listener: window.print() fires on tale:canvas:print, ignores unrelated messages', async () => {
    // The shell installs a listener that only acts on
    // `{ type: 'tale:canvas:print' }`. Patch `window.print` inside the
    // iframe to record calls, send a tale:canvas:print AND a noise
    // message, then ask the iframe to report what it saw.
    const userHtml = `<script>
      var calls = 0;
      window.print = function () { calls++; };
      window.addEventListener('message', function (event) {
        if (event && event.data && event.data.type === 'tale:report-print-calls') {
          parent.postMessage({ printCalls: calls }, '*');
        }
      });
      // Tell the parent we are ready to receive print signals.
      parent.postMessage({ ready: true }, '*');
    </script>`;
    const wrapped = wrapCanvasPreviewHtml(userHtml);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-modals');
    iframe.srcdoc = wrapped;

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('iframe never reported ready')),
        5000,
      );
      function onReady(e: MessageEvent) {
        if (e.source !== iframe.contentWindow) return;
        const data = e.data as { ready?: boolean };
        if (data?.ready) {
          clearTimeout(timer);
          window.removeEventListener('message', onReady);
          resolve();
        }
      }
      window.addEventListener('message', onReady);
    });

    document.body.appendChild(iframe);
    try {
      await ready;
      // Send the real print signal AND a noise message; only the first
      // should bump the counter.
      iframe.contentWindow?.postMessage({ type: 'tale:canvas:print' }, '*');
      iframe.contentWindow?.postMessage({ type: 'something:else' }, '*');

      const report = await new Promise<{ printCalls: number }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('iframe never reported print calls')),
            5000,
          );
          function onReport(e: MessageEvent) {
            if (e.source !== iframe.contentWindow) return;
            const data = e.data as { printCalls?: number };
            if (typeof data?.printCalls === 'number') {
              clearTimeout(timer);
              window.removeEventListener('message', onReport);
              resolve({ printCalls: data.printCalls });
            }
          }
          window.addEventListener('message', onReport);
          iframe.contentWindow?.postMessage(
            { type: 'tale:report-print-calls' },
            '*',
          );
        },
      );
      expect(report.printCalls).toBe(1);
    } finally {
      iframe.remove();
    }
  });

  test('quota cap throws QuotaExceededError inside the iframe', async () => {
    const userHtml = `<script>
      var report = { thrown: false };
      try {
        var big = '';
        // 6 MiB — exceeds the 5 MiB shim cap.
        for (var i = 0; i < 6; i++) big += new Array(1024 * 1024 + 1).join('a');
        localStorage.setItem('big', big);
      } catch (e) {
        report.thrown = true;
        report.name = e && e.name;
      }
      parent.postMessage(report, '*');
    </script>`;
    const report = (await runInSandbox(userHtml)) as Record<string, unknown>;
    expect(report.thrown).toBe(true);
    expect(report.name).toBe('QuotaExceededError');
  });
});
