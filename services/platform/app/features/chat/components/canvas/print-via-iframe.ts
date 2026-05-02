// Print arbitrary HTML through the same /canvas-preview shell that powers
// the HTML artifact renderer, by mounting a hidden iframe, POSTing the HTML
// to it, and triggering window.print() inside via postMessage. The shell's
// fresh-realm + permissive-CSP wrapper means we get the same isolation guarantees
// as the on-screen HTML viewer — and the print dialog only sees the artifact,
// not the surrounding chat UI.
//
// Used by the Markdown export path in canvas-pane.tsx; HTML artifacts have
// their own iframe already and call requestPrint() directly on the renderer ref.

interface PrintHtmlOptions {
  html: string;
  basePath: string;
}

const LOAD_TIMEOUT_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 60_000;

export function printHtmlInHiddenIframe(opts: PrintHtmlOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts allow-modals');
    iframe.title = 'PDF export';
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.name = `canvas-print-${Math.random().toString(36).slice(2)}`;

    const form = document.createElement('form');
    form.method = 'post';
    form.action = `${opts.basePath}/canvas-preview`;
    form.target = iframe.name;
    form.enctype = 'application/x-www-form-urlencoded';
    form.style.display = 'none';

    const input = document.createElement('textarea');
    input.name = 'html';
    input.value = opts.html;
    form.appendChild(input);

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('afterprint', onAfterPrint);
      iframe.removeEventListener('load', onLoad);
      clearTimeout(loadTimer);
      clearTimeout(cleanupTimer);
      iframe.remove();
      form.remove();
    }

    function onAfterPrint() {
      cleanup();
      resolve();
    }

    function onLoad() {
      // Iframe just navigated to the /canvas-preview response. The shell's
      // print listener (lib/canvas-preview-shell.ts PRINT_LISTENER) is
      // installed before <body>, so it's already wired by the time we post.
      clearTimeout(loadTimer);
      iframe.contentWindow?.postMessage({ type: 'tale:canvas:print' }, '*');
    }

    iframe.addEventListener('load', onLoad);
    window.addEventListener('afterprint', onAfterPrint);

    // Safety nets: if /canvas-preview never responds, or if afterprint never
    // fires (e.g. user closed the dialog without printing on a browser that
    // skips afterprint), still tear the iframe down so it doesn't accumulate.
    const loadTimer = setTimeout(() => {
      cleanup();
      reject(new Error('canvas-preview iframe did not load within 30s'));
    }, LOAD_TIMEOUT_MS);
    const cleanupTimer = setTimeout(() => {
      cleanup();
      resolve();
    }, CLEANUP_TIMEOUT_MS);

    document.body.appendChild(form);
    document.body.appendChild(iframe);
    form.submit();
  });
}
