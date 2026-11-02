import type { Page } from '@playwright/test';

export interface Overflow {
  /** `scrollWidth - clientWidth` of the document: more than 0 and the page scrolls sideways. */
  document: number;
  /** The same for `<body>` and for the app's `<main>`. */
  body: number;
  main: number;
  /**
   * Elements that stick out past the window's edges, other than in a region
   * that is meant to scroll sideways (a wide table in its own scroller) and the
   * parts that are hidden on purpose.
   */
  sticking: string[];
}

/**
 * How far the page reaches past the window sideways. The shell clips the
 * document (`overflow: clip`), so `scrollWidth <= clientWidth` alone could
 * hold while a button sits cut off at the edge: `sticking` names every element
 * that is laid out beyond the window and is not inside a scroller of its own
 * (or in a visually hidden box).
 */
export function horizontalOverflow(page: Page): Promise<Overflow> {
  return page.evaluate((): Overflow => {
    const root = document.documentElement;
    const main = document.querySelector('main');
    const width = window.innerWidth;
    const sticking: string[] = [];

    const hiddenOnPurpose = (element: Element) => {
      // The skip link waits outside the window until it has the focus.
      if (element.closest('a[href^="#"]')?.classList.contains('sr-only')) {
        return true;
      }
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return true;
        }
        if (node.getAttribute('aria-hidden') === 'true') return true;
      }
      return false;
    };
    // A scroller that sits inside the window holds what sticks out of it. So
    // does a box of a pixel that clips what it holds: the label a button
    // collapses to its icon stays in the page for assistive technology only.
    // A container as wide as the window (the shell, `main`) holds nothing: what
    // it clips is cut off at the edge, which is what this looks for.
    const heldInside = (element: Element) => {
      for (
        let node: Element | null = element.parentElement;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          box.left >= -0.5 &&
          box.right <= width + 0.5
        ) {
          return true;
        }
        if (
          (style.overflowX === 'hidden' || style.overflowX === 'clip') &&
          (box.width <= 2 || box.height <= 2)
        ) {
          return true;
        }
      }
      return false;
    };

    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= width + 0.5 && box.left >= -0.5) continue;
      if (hiddenOnPurpose(element) || heldInside(element)) continue;
      const label = (
        element.getAttribute('aria-label') ??
        element.textContent ??
        ''
      )
        .trim()
        .slice(0, 30);
      sticking.push(
        `<${element.tagName.toLowerCase()}> "${label}" ${Math.round(box.left)}..${Math.round(box.right)} of ${width}`,
      );
    }

    return {
      document: root.scrollWidth - root.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      main: main === null ? 0 : main.scrollWidth - main.clientWidth,
      sticking: sticking.slice(0, 10),
    };
  });
}
