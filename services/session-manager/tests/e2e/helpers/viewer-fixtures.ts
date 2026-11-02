import { collectConsoleErrors } from '@tale/e2e/smoke';

import { expect, test as base } from './fixtures';

interface ViewerFixtures {
  /**
   * Says that the page is about to log a console error on purpose (a request
   * that is answered 404, a socket that is cut), so that the check at the end
   * of the test lets it pass. Anything else the page logs fails the test.
   */
  allowConsoleError: (pattern: RegExp) => void;
}

/** The noise `collectConsoleErrors` ignores by default, which passing a list replaces. */
const BENIGN_NOISE = [
  /favicon/i,
  /ResizeObserver loop/i,
  /\[vite\]/i,
  /service worker/i,
  /Manifest:/i,
];

/**
 * The suite's `test`, plus a check that the page logged no console error and
 * threw no uncaught one while the test ran: a live view that works must not
 * complain, whatever a person does to it.
 */
export const test = base.extend<ViewerFixtures>({
  allowConsoleError: [
    async ({ page }, provide) => {
      const ignored = [...BENIGN_NOISE];
      const errors = collectConsoleErrors(page, ignored);
      await provide((pattern) => {
        ignored.push(pattern);
      });
      expect(errors, 'the page logged no console error').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
