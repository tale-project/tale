import type { RenderResult } from '@testing-library/react';
import { axe } from 'vitest-axe';

// WCAG 2.1 AA rules the design-system docs chrome asserts on.
// `color-contrast` is intentionally OFF: jsdom performs no layout and returns
// no real colours, so the rule can only ever report `incomplete` — real
// contrast is judged in the browser (the manual `A11Y-` sweep). Mirrors
// `services/docs/tests/utils/a11y.ts` and the package helper in
// `packages/ui/tests/utils/a11y.ts`; this site keeps its own copy because
// neither is exported.
const DEFAULT_RULES = {
  'color-contrast': { enabled: false },
  label: { enabled: true },
  'button-name': { enabled: true },
  'link-name': { enabled: true },
  'aria-allowed-attr': { enabled: true },
  'aria-required-attr': { enabled: true },
  'aria-valid-attr-value': { enabled: true },
  'heading-order': { enabled: true },
  'duplicate-id-aria': { enabled: true },
  'landmark-unique': { enabled: true },
  list: { enabled: true },
  listitem: { enabled: true },
  tabindex: { enabled: true },
};

/**
 * Run an axe audit on a container and throw on any violation. Caller `rules`
 * merge on top of the defaults instead of replacing them.
 */
export async function checkAccessibility(
  container: Element | RenderResult,
  options?: Parameters<typeof axe>[1],
) {
  const element = 'container' in container ? container.container : container;
  const { rules: callerRules, ...restOptions } = options ?? {};
  const results = await axe(element, {
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
