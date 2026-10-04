// In-page task-board observations, installed before navigation.
// Records long tasks, event timing, LCP, and offers __perf.watch(selector, predicate) → resolves with the
// time the DOM first satisfies the predicate (MutationObserver) and the end of the frame that shows it
// (rAF, then a MessageChannel task after that frame's rendering step).
(() => {
  if (window.__perf) return;
  try {
    localStorage.setItem('tale_perf', '1');
  } catch (error) {
    console.warn('[perf] localStorage', error);
  }
  const perf = { longtasks: [], events: [], lcp: [], inputs: [] };
  window.__perf = perf;
  const observe = (type, onEntry, extra = {}) => {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) onEntry(e);
      }).observe({ type, buffered: true, ...extra });
    } catch (error) {
      console.warn('[perf] observer', type, error);
    }
  };
  observe('longtask', (e) =>
    perf.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]),
  );
  observe('largest-contentful-paint', (e) =>
    perf.lcp.push(Math.round(e.startTime)),
  );
  observe(
    'event',
    (e) =>
      perf.events.push({
        name: e.name,
        start: Math.round(e.startTime),
        dur: e.duration,
        procStart: Math.round(e.processingStart),
        procEnd: Math.round(e.processingEnd),
      }),
    { durationThreshold: 16 },
  );
  for (const type of ['keydown', 'click', 'pointerdown']) {
    window.addEventListener(
      type,
      (ev) => {
        perf.inputs.push({ type, key: ev.key ?? null, t: ev.timeStamp });
      },
      { capture: true },
    );
  }
  perf.watch = (selector, predicate, label) =>
    new Promise((resolve) => {
      let done = false;
      const check = (source) => {
        if (done) return;
        const count = document.querySelectorAll(selector).length;
        if (!predicate(count)) return;
        done = true;
        const tDom = performance.now();
        mo.disconnect();
        requestAnimationFrame(() => {
          const tRaf = performance.now();
          const ch = new MessageChannel();
          ch.port1.addEventListener(
            'message',
            () => {
              resolve({
                label,
                count,
                source,
                tDom,
                tRaf,
                tFrame: performance.now(),
              });
              ch.port1.close();
              ch.port2.close();
            },
            { once: true },
          );
          ch.port1.start();
          ch.port2.postMessage(0);
        });
      };
      const mo = new MutationObserver(() => check('mutation'));
      const start = () => {
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
        check('initial');
      };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    });
  // Match the dialog's own accessible title. Body text and a nested dialog's
  // title cannot satisfy readiness for a different task.
  const namedDialogs = (title) =>
    [...document.querySelectorAll('[role="dialog"]')].filter((dialog) => {
      const labels = (dialog.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id))
        .filter((label) => label?.closest('[role="dialog"]') === dialog);
      const name = labels.length
        ? labels.map((label) => label.textContent || '').join(' ')
        : dialog.getAttribute('aria-label');
      return name?.trim() === title;
    });
  perf.watchDialog = (title, open) =>
    new Promise((resolve, reject) => {
      let done = false;
      const closing = open ? undefined : namedDialogs(title);
      if (!open && closing.length !== 1) {
        reject(new Error('Expected exactly one owned dialog before close'));
        return;
      }
      const check = (source) => {
        if (done) return;
        const matches = namedDialogs(title);
        if (matches.length > 1) {
          done = true;
          mo.disconnect();
          reject(new Error('Task dialog accessible title is ambiguous'));
          return;
        }
        const ready = open
          ? matches.length === 1 &&
            !matches[0].querySelector('[aria-busy="true"]')
          : !closing[0].isConnected;
        if (!ready) return;
        done = true;
        const tDom = performance.now();
        mo.disconnect();
        requestAnimationFrame(() => {
          const tRaf = performance.now();
          const ch = new MessageChannel();
          ch.port1.addEventListener(
            'message',
            () => {
              resolve({
                label: open ? 'dialog-open' : 'dialog-close',
                source,
                tDom,
                tRaf,
                tFrame: performance.now(),
              });
              ch.port1.close();
              ch.port2.close();
            },
            { once: true },
          );
          ch.port1.start();
          ch.port2.postMessage(0);
        });
      };
      const mo = new MutationObserver(() => check('mutation'));
      mo.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-busy', 'aria-labelledby', 'aria-label'],
        characterData: true,
      });
      if (open) check('initial');
    });
})();
