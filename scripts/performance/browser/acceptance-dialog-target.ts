import assert from 'node:assert/strict';

import type { Page } from '../../../packages/e2e/src/index.ts';
import { cards } from './browser-session.ts';

/** Open and focus-return checks use accessible cards. Only close setup may
 * inspect the background opener hidden from accessibility by the open modal. */
export function acceptanceDialogTargets(
  page: Pick<Page, 'locator' | 'getByRole'>,
  title: string,
) {
  const card = page
    .locator(cards)
    .and(page.getByRole('button', { name: title, exact: true }));
  const hiddenOpener = page.locator(cards).and(
    page.getByRole('button', {
      name: title,
      exact: true,
      includeHidden: true,
    }),
  );
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  return {
    card,
    dialog,
    async assertPrecondition(opening: boolean) {
      assert.equal(
        await (opening ? card : hiddenOpener).count(),
        1,
        'Dialog target is ambiguous',
      );
      if (opening)
        assert.equal(
          await page.getByRole('dialog').count(),
          0,
          'Open predicate must start false',
        );
      else
        assert.equal(await dialog.count(), 1, 'Close must own the open target');
    },
  };
}
