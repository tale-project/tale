import type { Page } from '@playwright/test';
import axe from 'axe-core';

declare global {
  interface Window {
    /** Put there by `violationsOf`. */
    axe: typeof axe;
  }
}

/**
 * The accessibility violations (WCAG 2.0/2.1 A and AA) of what the page shows
 * now. jsdom cannot measure contrast, so this is the audit of the colours: run
 * it in light and in dark mode.
 */
export async function violationsOf(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
    return result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ html, failureSummary }) => ({
        html,
        failureSummary,
      })),
    }));
  });
}
