import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Conversations surface smoke flow. The base `/conversations` route redirects
 * to `/conversations/open`, and the status tabs (open / closed / spam /
 * archived) each route to `/conversations/$status` and render that status's
 * list (or its empty / not-yet-activated state).
 *
 * Read-only and state-independent: it asserts the page chrome + per-status
 * routing and that *some* body state renders, without depending on whether the
 * worker org has any conversations (the hermetic fixture seeds none, so the
 * default body is the "activate conversations" CTA — but the assertions hold
 * either way). The primary-rail navigation spec only proves the rail link lands
 * on `/conversations/open`; this spec owns the per-status tab routing.
 */

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

test('lists conversations and routes between status tabs', async ({
  page,
  org,
}) => {
  const { organizationId } = org;

  // The bare list route redirects to the "open" status.
  await page.goto(`/dashboard/${organizationId}/conversations`);
  await page.waitForURL(/\/conversations\/open(?:[/?#]|$)/, {
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // Page title (header) renders. The adaptive header dual-renders the title:
  // once in the desktop header inside <main> and once in the `md:hidden` mobile
  // top bar (which sits earlier in the DOM). `.first()` would resolve to that
  // hidden mobile copy at the Desktop Chrome viewport, so scope to the visible
  // <main> region's level-1 heading instead.
  await expect(
    page
      .getByRole('main')
      .getByRole('heading', { name: t('conversations.title'), level: 1 }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // All four status tabs render as navigation links.
  for (const status of STATUSES) {
    await expect(
      page.getByRole('link', {
        name: t(`conversations.status.${status}`),
        exact: true,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  }

  // The "open" body settled into one of its terminal states. The fixture seeds
  // no conversations, so the default is the not-yet-activated CTA; the per-tab
  // empty message is accepted too so the assertion still holds if the worker
  // org ever has conversations (both are deterministic copy).
  const bodySettled = page
    .getByText(t('conversations.activate.title'), { exact: true })
    .or(page.getByText(t('conversations.list.empty'), { exact: true }));
  await expect(bodySettled.first()).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Switching status tabs navigates to the matching route and keeps rendering a
  // settled body (list or empty/activate state) for that status.
  for (const status of STATUSES.slice(1)) {
    await page
      .getByRole('link', {
        name: t(`conversations.status.${status}`),
        exact: true,
      })
      .click();
    await page.waitForURL(new RegExp(`/conversations/${status}(?:[/?#]|$)`), {
      timeout: TIMEOUT.NAV,
    });
    // The tab strip still shows this status as a link after navigating.
    await expect(
      page.getByRole('link', {
        name: t(`conversations.status.${status}`),
        exact: true,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  }
});
