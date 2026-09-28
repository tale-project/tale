import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor } from '@/tests/utils/render';

const { runTest } = vi.hoisted(() => ({ runTest: vi.fn() }));

vi.mock('../hooks/mutations', () => ({
  useTestModerationProvider: () => ({ mutateAsync: runTest, isPending: false }),
}));

import { TestConnectionPanel } from './moderation-test-connection-panel';

beforeEach(() => {
  runTest.mockReset();
});

// The refusal's own `message` is its serialized payload; the result used to
// read `{"code":"UNAUTHORIZED",…}` as its hint.
describe.each(SHIPPED_LOCALES)(
  'the moderation test after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it('says the session ended', async () => {
      runTest.mockImplementation(() => lapsedSessionRefusal());
      const { user } = render(
        <TestConnectionPanel organizationId="org-1" disabled={false} />,
      );
      await waitFor(() => expect(i18n.language).toBe(locale));

      await user.click(
        screen.getByRole('button', {
          name: i18n.getFixedT(
            locale,
            'governance',
          )('moderationProvider.runTest'),
        }),
      );

      expect(await screen.findByText(SESSION_ENDED[locale])).toBeVisible();
      expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
    });
  },
);

it('keeps the words of a failure that is not a refusal', async () => {
  runTest.mockRejectedValue(new Error('The provider timed out'));
  const { user } = render(
    <TestConnectionPanel organizationId="org-1" disabled={false} />,
  );

  await user.click(screen.getByRole('button', { name: 'Run test' }));

  expect(await screen.findByText('The provider timed out')).toBeVisible();
});

// The browser's own words for a request that got no answer ("Failed to
// fetch", "Load failed") are English and differ per engine.
it('says a lost connection in words', async () => {
  runTest.mockRejectedValue(new TypeError('Failed to fetch'));
  const { user } = render(
    <TestConnectionPanel organizationId="org-1" disabled={false} />,
  );

  await user.click(screen.getByRole('button', { name: 'Run test' }));

  expect(
    await screen.findByText(
      "Couldn't reach Tale. Check your connection and try again.",
    ),
  ).toBeVisible();
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
});
