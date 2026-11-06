import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

import { ApiKeyOwnerCell } from './api-key-owner-cell';

/**
 * The mark on the viewer's own key that this organization blocked, laid out
 * by a real browser in the keys table's "Belongs to" column. Drawn as wide
 * as its words, it ran over the next column's date at 1280 px in English,
 * and further in German and French; jsdom lays nothing out, so only here can
 * it be seen to stay in its column, every word of it shown.
 */

/** The width the keys table gives "Belongs to" at 1280 px. */
const COLUMN_WIDTH = 160;

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

describe('the blocked mark of the viewer’s own key', () => {
  for (const language of ['en', 'de', 'fr']) {
    it(`stays in its column and shows every word, in ${language}`, async () => {
      await i18n.changeLanguage(language);
      render(
        <div data-testid="column" style={{ width: COLUMN_WIDTH }}>
          <ApiKeyOwnerCell
            apiKey={{
              owner: { kind: 'user' },
              role: null,
              createdBy: null,
              blockedHere: true,
            }}
            viewerUserId="user-1"
          />
        </div>,
      );

      const words = i18n.t('apiKeys.owner.blockedHere', { ns: 'settings' });
      const mark = screen.getByText(words);
      const column = screen.getByTestId('column').getBoundingClientRect();
      const badge = mark.parentElement?.getBoundingClientRect();
      expect(badge?.right).toBeLessThanOrEqual(column.right + 0.5);
      // Wrapped, not cut: the words take no more room than they are given.
      expect(mark.scrollWidth).toBeLessThanOrEqual(mark.clientWidth);
    });
  }
});
