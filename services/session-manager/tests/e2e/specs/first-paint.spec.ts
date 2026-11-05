import { TIMEOUT } from '../helpers/env';
import { centersOf, framesOf, recordFrames } from '../helpers/first-paint';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

// How a page appears when it is opened: the frame of the app the server sends
// in the page itself (the boot shell, `scripts/prerender-boot-shell.ts`), then
// the page as its data says, drawn by React in one go. Never a loading layout
// that an answer replaces a frame later: a table with no row flashed its
// toolbar and six masked rows before its empty state (2026-11-05).

test('the page the server sends is the frame of the app, its rail where the app draws it', async ({
  browser,
  page,
}) => {
  // Before any script: the page as the server sends it.
  const still = await browser.newContext({ javaScriptEnabled: false });
  const sent = await still.newPage();
  await sent.goto('/proxies');
  const shell = sent.locator('[data-boot-shell]');
  await expect(shell).toBeAttached();
  await expect(shell).toHaveAttribute('aria-hidden', 'true');
  await expect(shell).toHaveText('');
  const masked = await centersOf(shell.locator('[data-skeleton-mask]'));
  await still.close();

  await page.goto('/proxies');
  const rail = page.getByRole('complementary', {
    name: t('navigation.landmark'),
  });
  await expect(rail).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // The logo, the sections and Settings: the tiles the shell masks.
  expect(masked).toEqual(await centersOf(rail.locator('svg')));
});

const EMPTY_LISTS = [
  { address: '/sessions', empty: t('sessions.empty.title') },
  { address: '/proxies', empty: t('proxies.empty.title') },
  { address: '/secrets', empty: t('secrets.empty.title') },
];

for (const { address, empty } of EMPTY_LISTS) {
  test(`${address} with nothing in it goes from the frame to its empty state, never through masked rows or a toolbar`, async ({
    page,
  }) => {
    await recordFrames(page);
    await page.goto(address);
    await expect(page.getByRole('heading', { name: empty })).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });

    const frames = await framesOf(page);
    expect(
      frames.filter((frame) => frame.masked || frame.search),
      'frames that showed a loading layout',
    ).toEqual([]);
    // The first frame React draws is the empty state already, and before it
    // there is nothing but the frame the server sent.
    const first = frames.findIndex((frame) => frame.root === 'app');
    expect(frames[first]?.headings).toContain(empty);
    expect(frames.slice(0, first).map((frame) => frame.root)).toEqual(
      Array.from({ length: first }, () => 'shell'),
    );
  });
}
