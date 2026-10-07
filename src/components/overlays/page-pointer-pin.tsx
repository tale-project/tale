'use client';

import { useLayoutEffect } from 'react';

/** How many overlay modals hold the pin (nested dialogs stack). */
let pins = 0;

/** Whether something still makes the page inert from `<body>`: Radix's
 *  inline style, or a modal portal the global style isolates the page for. */
function bodyIsInert(): boolean {
  return (
    document.body.style.pointerEvents === 'none' ||
    document.querySelector('body > [data-tale-modal]') !== null
  );
}

/** Drop the pin once no modal holds it and the body is live again: then the
 *  root's `auto` equals what it inherits, and removing it restyles nothing. */
function unpinWhenLive(root: HTMLElement) {
  if (pins > 0) return;
  if (bodyIsInert()) {
    requestAnimationFrame(() => unpinWhenLive(root));
    return;
  }
  root.style.removeProperty('pointer-events');
}

/**
 * Keeps the page's root out of a modal's `pointer-events: none` on `<body>`.
 *
 * A modal makes the page inert by setting that property on the body (Radix
 * inline, the global style from the modal's first style pass). It is
 * inherited, so the browser restyled every element of the page when a modal
 * opened and again when it closed: about 40 ms on a 7,800-element page, and
 * more than half a second on a large task board (#3974). A modal with an
 * overlay does not need the page inert, because the overlay covers the
 * viewport and takes every pointer event the page would get. So while one is
 * open the app root (`#root`) carries an explicit `pointer-events: auto`, the
 * body's change stops there, and nothing under it is restyled.
 *
 * Render it inside an overlay modal's content, never in a menu, select or
 * popover: those have no overlay, and the inert page is what keeps a click
 * beside them from reaching the control under the pointer. The pin lands in a
 * layout effect, before the modal's first style pass and before any of
 * Radix's effects. It comes off only once the body is live again, so neither
 * step changes a computed style.
 */
export function PagePointerPin() {
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (root === null) return undefined;
    pins += 1;
    root.style.pointerEvents = 'auto';
    return () => {
      pins -= 1;
      requestAnimationFrame(() => unpinWhenLive(root));
    };
  }, []);
  return null;
}
