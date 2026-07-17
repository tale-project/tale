/**
 * In-page overlay for the docs video recorder, installed via addInitScript so
 * it survives full navigations (SPA route changes keep the DOM anyway).
 * Three jobs:
 *
 *  1. The visible cursor — a soft dot that glides (WAAPI, eased) to wherever
 *     the Node-side `Cursor` class is about to really click, plus a click
 *     ripple. The real Playwright mouse lands on the same pixel, so what the
 *     viewer sees is what the app receives.
 *  2. The pacemaker — CDP screencast only emits frames on compositor commits,
 *     so an idle page produces NO frames and the composed video would hold a
 *     stale frame across a scene boundary. A tiny always-animating element
 *     forces a steady commit cadence.
 *  3. Cosmetics — hide scrollbars (they flicker in and out of screencast
 *     frames) and never intercept input (pointer-events: none everywhere).
 *
 * Plain JS on purpose: Playwright injects this file verbatim into the page.
 */

(() => {
  if (window.__taleCursorInstalled) return;
  window.__taleCursorInstalled = true;

  const CURSOR_SIZE = 26;
  const STORAGE_KEY = '__tale-video-cursor-pos';

  function install() {
    if (!document.body) return;

    const style = document.createElement('style');
    style.textContent = [
      '::-webkit-scrollbar { width: 0 !important; height: 0 !important; }',
      'html { scrollbar-width: none !important; }',
      '@keyframes __tale-pacemaker { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      '@keyframes __tale-ripple { from { transform: translate(-50%, -50%) scale(0.4); opacity: 0.45; } to { transform: translate(-50%, -50%) scale(2.4); opacity: 0; } }',
    ].join('\n');
    document.head.appendChild(style);

    // Pacemaker: 2×2 px, bottom-right, effectively invisible but animating on
    // the compositor every frame.
    const pacemaker = document.createElement('div');
    pacemaker.setAttribute('aria-hidden', 'true');
    pacemaker.style.cssText =
      'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;' +
      'background:#888;z-index:2147483646;pointer-events:none;' +
      'animation:__tale-pacemaker 0.5s linear infinite;';
    document.body.appendChild(pacemaker);

    const cursor = document.createElement('div');
    cursor.setAttribute('aria-hidden', 'true');
    // Positioned exclusively via transform so the glide runs on the
    // compositor — main-thread work (streaming markdown, re-renders) cannot
    // make the cursor stutter.
    cursor.style.cssText =
      `position:fixed;left:0;top:0;width:${CURSOR_SIZE}px;height:${CURSOR_SIZE}px;` +
      'border-radius:50%;background:rgba(15,23,42,0.85);' +
      'border:2px solid rgba(255,255,255,0.95);' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.35);' +
      'z-index:2147483647;pointer-events:none;will-change:transform;' +
      'display:none;';
    document.body.appendChild(cursor);

    const HALF = CURSOR_SIZE / 2;
    const toTransform = (x, y) => `translate(${x - HALF}px, ${y - HALF}px)`;

    let position = { x: innerWidth / 2, y: innerHeight * 0.75 };
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) position = JSON.parse(saved);
    } catch {
      // First page of the session — keep the default resting point.
    }

    const place = (x, y) => {
      position = { x, y };
      cursor.style.transform = toTransform(x, y);
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(position));
      } catch {
        // Session storage can be unavailable on file:// cards — harmless.
      }
    };
    place(position.x, position.y);

    window.__taleCursor = {
      show() {
        cursor.style.display = 'block';
      },
      hide() {
        cursor.style.display = 'none';
      },
      // Scene changes veil the cursor with `visibility` — moveTo() forces
      // `display:block` on every glide, which would defeat hide().
      veil() {
        cursor.style.visibility = 'hidden';
      },
      unveil() {
        cursor.style.visibility = 'visible';
      },
      place,
      /** Glide to (x, y) over `ms`, resolving when the motion settles. */
      async moveTo(x, y, ms) {
        cursor.style.display = 'block';
        const from = { x: position.x, y: position.y };
        const animation = cursor.animate(
          [
            { transform: toTransform(from.x, from.y) },
            { transform: toTransform(x, y) },
          ],
          {
            duration: ms,
            easing: 'cubic-bezier(0.33, 0, 0.2, 1)',
            fill: 'forwards',
          },
        );
        await animation.finished.catch(() => {});
        place(x, y);
        animation.cancel();
      },
      ripple() {
        const ring = document.createElement('div');
        ring.setAttribute('aria-hidden', 'true');
        ring.style.cssText =
          `position:fixed;left:${position.x}px;top:${position.y}px;` +
          `width:${CURSOR_SIZE + 10}px;height:${CURSOR_SIZE + 10}px;` +
          'border-radius:50%;border:3px solid rgba(59,130,246,0.9);' +
          'z-index:2147483647;pointer-events:none;' +
          'transform:translate(-50%,-50%);' +
          'animation:__tale-ripple 0.45s ease-out forwards;';
        document.body.appendChild(ring);
        setTimeout(() => ring.remove(), 500);
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
