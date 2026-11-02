import type { Page } from '@playwright/test';

declare global {
  interface Window {
    /** What the page's Content-Security-Policy refused, as `watchPolicyViolations` noted it. */
    policyViolations?: string[];
  }
}

/**
 * Notes every Content-Security-Policy violation the page raises, from its first
 * script on, and gives back what is read of them. Call it before the page
 * opens. A refusal the page handles itself (a library that probes for `eval`
 * and carries on without it) logs nothing to the console, so only the event
 * tells: it names the directive, what was blocked and where the script that
 * asked for it is.
 */
export async function watchPolicyViolations(
  page: Page,
): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    window.policyViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.policyViolations?.push(
        `${event.violatedDirective} refused ${event.blockedURI} (asked at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber})`,
      );
    });
  });
  return () => page.evaluate(() => window.policyViolations ?? []);
}
