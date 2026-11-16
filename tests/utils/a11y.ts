import type { RenderResult } from '@testing-library/react';
import { axe } from 'vitest-axe';

// WCAG 2.1 AA rules we assert on. `color-contrast` is intentionally OFF: jsdom
// performs no layout and returns no real colors, so the rule can only ever
// report `incomplete` (never a `violation`) — it is the single most expensive
// axe rule (it walks every node calling getComputedStyle, which also produces
// the "Not implemented: getComputedStyle with pseudo-elements" log storm) yet
// contributes zero signal here. Real contrast is covered by the Storybook /
// browser projects, where layout exists.
const DEFAULT_RULES = {
  'color-contrast': { enabled: false },
  label: { enabled: true },
  'button-name': { enabled: true },
  'link-name': { enabled: true },
  'image-alt': { enabled: true },
  'aria-allowed-attr': { enabled: true },
  'aria-required-attr': { enabled: true },
  'aria-valid-attr-value': { enabled: true },
  'heading-order': { enabled: true },
  'duplicate-id-aria': { enabled: true },
  tabindex: { enabled: true },
};

/**
 * Run an axe accessibility audit on a container and throw on any violation.
 * Caller `rules` merge on top of the defaults instead of replacing them.
 */
export async function checkAccessibility(
  container: Element | RenderResult,
  options?: Parameters<typeof axe>[1],
) {
  const element = 'container' in container ? container.container : container;
  const { rules: callerRules, ...restOptions } = options ?? {};
  const results = await axe(element, {
    // Only `violations` are read, so skip building the large passes /
    // incomplete / inapplicable result objects.
    resultTypes: ['violations'],
    rules: { ...DEFAULT_RULES, ...callerRules },
    ...restOptions,
  });

  if (results.violations.length > 0) {
    const violationMessages = results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.description}\n` +
          violation.nodes.map((node) => `  - ${node.html}`).join('\n'),
      )
      .join('\n\n');
    throw new Error(`Accessibility violations:\n${violationMessages}`);
  }
}

/** Assert an element can receive focus. */
export function expectFocusable(element: HTMLElement) {
  element.focus();
  if (document.activeElement !== element) {
    throw new Error('Expected element to be focusable, but it is not');
  }
}
