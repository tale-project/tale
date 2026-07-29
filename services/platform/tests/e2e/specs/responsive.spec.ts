import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Mobile / responsive layout coverage. Runs as the worker's owner but OVERRIDES
 * the project's Desktop Chrome viewport with a phone-sized one (`test.use`
 * below); the auth storageState carries through, so each flow runs against the
 * worker's seeded org at `< md` width.
 *
 * The app's responsive split is the Tailwind `md` breakpoint (768px): desktop
 * chrome is `hidden md:flex` (side rail, settings desktop Save slot); mobile
 * chrome is `md:hidden` (the in-flow `BottomTabBar`, the content-width floating
 * Save dock above it). There is NO hamburger drawer — primary nav is the bottom
 * tab bar, and a trailing "More" tab opens a bottom `Sheet` (Radix dialog named
 * "More") with the overflow destinations. The settings test makes a throwaway
 * dirty edit to reveal the floating Save, then reloads to discard it (nothing
 * persists).
 */

// Phone viewport — OVERRIDES the project's Desktop Chrome viewport for this file
// while the owner storageState (auth) carries through unchanged.
test.use({ viewport: { width: 390, height: 844 } });

/**
 * Settings mounts Save once via `useIsMobile`: the floating dock on `< md`, the
 * header slot on `md+`. At phone width the visible Save is the floating dock.
 */
function visibleSaveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

test.describe('responsive / mobile layout', () => {
  test('app shell: desktop rail collapses; bottom tab bar + More sheet drive nav', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/chat`);

    // The mobile primary-nav landmark (the in-flow bottom tab bar) is the stable
    // anchor that the shell finished mounting at mobile width.
    const mobileNav = page.getByRole('navigation', {
      name: t('navigation.aria.primaryNavigation'),
    });
    await expect(mobileNav).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // The desktop side rail lives in a `hidden md:flex` column — display:none.
    await expect(
      page.getByRole('navigation', { name: t('common.aria.mainNavigation') }),
    ).toBeHidden();

    // "More" is the menu toggle that opens the overflow Sheet; scope to the
    // mobile nav so it can't match a stray control elsewhere.
    const moreTab = mobileNav.getByRole('button', {
      name: t('navigation.more'),
    });
    await expect(moreTab).toBeVisible();
    await moreTab.click();

    // The Sheet is a Radix dialog whose accessible name is its title ("More").
    const moreSheet = page.getByRole('dialog', { name: t('navigation.more') });
    await expect(moreSheet).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The overflow destinations appear in the drawer (read-only — no navigate).
    await expect(
      moreSheet.getByRole('button', { name: t('navigation.knowledge') }),
    ).toBeVisible();
    await expect(
      moreSheet.getByRole('button', { name: t('navigation.userSettings') }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(moreSheet).toBeHidden({ timeout: TIMEOUT.VISIBLE });
  });

  test('settings: the floating Save dock is the visible Save cluster', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    // The account form is directly navigable at any width (only the bare
    // `/settings` overviews redirect on desktop).
    await page.goto(`/dashboard/${organizationId}/settings/account`);

    // The Profile section heading is the page's first content (no page title).
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // Target the input by role: SettingsRow names a wrapper div with the same
    // text, so getByLabel would resolve to the div, not the control.
    const nameField = page.getByRole('textbox', {
      name: t('settings.account.profile.name'),
    });
    await expect(nameField).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(nameField).toBeEnabled();

    // Save mounts once (`useIsMobile` gates floating vs header). While clean
    // it's the visible-but-disabled floating dock above the bottom tab bar.
    const save = visibleSaveButton(page);
    await expect(save).toHaveCount(1, { timeout: TIMEOUT.VISIBLE });
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled();

    // A throwaway dirty edit enables the floating Save. NOTHING is saved.
    const originalName = await nameField.inputValue();
    await nameField.fill(`${originalName} (responsive-probe)`);
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });

    // Still exactly one Save button at `< md` (header slot is unmounted).
    await expect(
      page.getByRole('button', { name: t('common.actions.save'), exact: true }),
    ).toHaveCount(1);

    // Discard via reload — the form re-seeds, so the probe edit never persists.
    const reloadedField = page.getByRole('textbox', {
      name: t('settings.account.profile.name'),
    });
    await reloadAndSettle(page, reloadedField);
    await expect(reloadedField).toHaveValue(originalName, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('chat: the composer renders and is enabled at mobile width', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/chat`);

    // The composer textarea is not viewport-gated; it must render and accept
    // input at phone width with the seeded fixture agent available. Read-only —
    // we never send, so nothing persists in the shared worker org.
    const composer = page.getByRole('textbox', {
      name: t('chat.aria.chatInput'),
    });
    await expect(composer).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(composer).toBeEnabled();
  });

  test('list page: contacts renders usably at mobile width', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/contacts`);

    // The seeded org ships no contacts, so the list settles into either its
    // always-present writer import menu OR its empty-state. Accepting either
    // (rather than racing one specific element) means we never assert
    // mid-skeleton; both prove the table chrome rendered and is reachable at
    // phone width. Read-only — no rows are created.
    const importMenu = page.getByRole('button', {
      name: t('contacts.addButton'),
    });
    const emptyState = page.getByText(t('emptyStates.contacts.title'));
    await expect(importMenu.or(emptyState).first()).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  });
});
