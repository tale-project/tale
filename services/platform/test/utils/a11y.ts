import { axe } from 'vitest-axe';
import { RenderResult } from '@testing-library/react';

/**
 * Run axe accessibility audit on a container
 */
export async function checkAccessibility(
  container: Element | RenderResult,
  options?: Parameters<typeof axe>[1]
) {
  const element = 'container' in container ? container.container : container;
  const results = await axe(element, {
    rules: {
      // WCAG 2.1 AA rules
      'color-contrast': { enabled: true },
      label: { enabled: true },
      'button-name': { enabled: true },
      'link-name': { enabled: true },
      'image-alt': { enabled: true },
    },
    ...options,
  });

  // Check for violations
  if (results.violations.length > 0) {
    const violationMessages = results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.description}\n` +
          violation.nodes.map((node) => `  - ${node.html}`).join('\n')
      )
      .join('\n\n');
    throw new Error(`Accessibility violations:\n${violationMessages}`);
  }
}

/**
 * Assert element is focusable
 */
export function expectFocusable(element: HTMLElement) {
  element.focus();
  if (document.activeElement !== element) {
    throw new Error(`Expected element to be focusable, but it is not`);
  }
}

