import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Mobile / responsive layout coverage. Runs as the pre-authenticated owner
 * (chromium project storageState) but OVERRIDES the project's Desktop Chrome
 * viewport with a phone-sized one (`test.use({ viewport })` below). The owner
 * storageState is preserved — only the viewport changes — so every flow runs
 * against the same seeded org as the desktop specs, just at `< md` width.
 *
 * The app's responsive split is driven by Tailwind's `md` breakpoint (768px):
 *  - Desktop chrome is `hidden md:flex` (the side-nav rail, the settings header
 *    Save/Discard slot, the chat header bar).
 *  - Mobile chrome is `md:hidden` (the in-flow bottom tab bar, the settings
 *    mobile Save bar, the mobile top header).
 * `@tale/ui`'s `useIsMobile()` (`useBreakpoint() === 'mobile'`, `< 768px`) also
 * gates JS-level mobile-only renders (the settings overview section list).
 *
 * At 390×844 (`< md`) the mobile variants are the visible ones and the desktop
 * variants are display:none — so each test asserts the MOBILE affordance is the
 * one in play. Read-only by construction except the settings flow, which makes
 * a throwaway dirty edit purely to reveal the mobile Save bar, then RELOADS to
 * discard it without ever saving (nothing is persisted).
 *
 * IMPORTANT — the app shell has NO hamburger/sheet-drawer nav. The desktop side
 * rail collapses on mobile and primary navigation moves to an in-flow
 * `BottomTabBar` (`@tale/ui/bottom-tab-bar`, a `<nav aria-label="Primary
 * navigation">` of buttons). A trailing "More" tab opens a bottom `Sheet`
 * (Radix dialog, accessible name "More") listing the overflow destinations
 * (Knowledge, Automations, Settings). This spec treats the "More" tab as the
 * "menu toggle" and the bottom Sheet as the "mobile menu/drawer". See the
 * returned caveats for the exact DOM.
 */

// Phone viewport. Placed at the top of the file so it OVERRIDES the chromium
// project's `devices['Desktop Chrome']` viewport for every test here, while the
// project's owner `storageState` (auth) carries through unchanged.
test.use({ viewport: { width: 390, height: 844 } });

const FIRST_PAINT_TIMEOUT = 60_000;

/**
 * The settings Save/Discard cluster renders in two layout positions:
 *  - mobile bar  — `SettingsMobileActionBar`, wrapper `md:hidden` (visible here)
 *  - desktop slot — `SettingsEditorActionsSlot`, wrapper `hidden md:flex`, and
 *    itself nested inside the `AdaptiveHeaderRoot` (also `hidden md:flex`). The
 *    header registers its children into a context slot that the mobile top bar
 *    re-renders, so this desktop slot's markup appears more than once in the
 *    DOM — but every copy stays `hidden md:flex`, i.e. display:none here.
 * Both clusters mount as soon as the form does (the page registers its editor
 * controller on mount) and are merely `disabled` until the form is dirty — so
 * "is a Save button present" is not a dirty signal; "is it enabled" is. At
 * `< md` width the ONLY place a Save button can be visible is the mobile bar,
 * so the visible-filtered Save button is unambiguously the mobile variant.
 */
function visibleSaveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

test.describe('responsive / mobile layout', () => {
  test('app shell: desktop rail collapses; bottom tab bar + More sheet drive nav', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/chat`);

    // The mobile primary-nav landmark is the in-flow bottom tab bar
    // (`<nav aria-label="Primary navigation">`, `md:hidden`). It's the stable
    // anchor that the shell finished mounting at mobile width.
    const mobileNav = page.getByRole('navigation', {
      name: t('navigation.aria.primaryNavigation'),
    });
    await expect(mobileNav).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });

    // The desktop side rail (`<nav aria-label="Main navigation">`) lives in a
    // `hidden md:flex` column — display:none at this width.
    await expect(
      page.getByRole('navigation', { name: t('common.aria.mainNavigation') }),
    ).toBeHidden();

    // "More" is the menu toggle: a bottom-tab-bar button that opens the
    // overflow Sheet. Scope it to the mobile nav so it can't match a stray
    // control elsewhere.
    const moreTab = mobileNav.getByRole('button', {
      name: t('navigation.more'),
    });
    await expect(moreTab).toBeVisible();
    await moreTab.click();

    // The Sheet is a Radix dialog whose accessible name is its title ("More").
    const moreSheet = page.getByRole('dialog', { name: t('navigation.more') });
    await expect(moreSheet).toBeVisible({ timeout: 20_000 });

    // The drawer lists the overflow destinations as buttons. Assert the
    // nav links appear in the mobile menu (read-only — we do NOT navigate).
    await expect(
      moreSheet.getByRole('button', { name: t('navigation.knowledge') }),
    ).toBeVisible();
    await expect(
      moreSheet.getByRole('button', { name: t('navigation.automations') }),
    ).toBeVisible();
    await expect(
      moreSheet.getByRole('button', { name: t('navigation.userSettings') }),
    ).toBeVisible();

    // Close the drawer without navigating, leaving no state behind.
    await page.keyboard.press('Escape');
    await expect(moreSheet).toBeHidden({ timeout: 20_000 });
  });

  test('settings: the mobile Save bar is the visible Save cluster', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    // The account form is directly navigable at any width (only the bare
    // `/settings` + `/settings/personal` overviews redirect on desktop).
    await page.goto(`/dashboard/${organizationId}/settings/account`);

    // The Profile section heading is the page's first content (no page title).
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });

    const nameField = page.getByLabel(t('settings.account.profile.name'));
    await expect(nameField).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    await expect(nameField).toBeEnabled();

    // The Save/Discard cluster mounts with the form (the page registers its
    // editor controller on mount, not on first edit) — it's `disabled` until
    // the form is dirty. At `< md` width the ONLY visible cluster is the mobile
    // bar, so exactly one Save button is visible, and it starts disabled.
    const save = visibleSaveButton(page);
    await expect(save).toHaveCount(1, { timeout: 20_000 });
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled();

    // A throwaway dirty edit enables the cluster. NOTHING is saved — we reload
    // to discard below.
    const originalName = await nameField.inputValue();
    await nameField.fill(`${originalName} (responsive-probe)`);

    // Still exactly one visible Save button — the mobile bar — now enabled.
    // The desktop clusters (`hidden md:flex`) stay display:none at this width.
    await expect(save).toHaveCount(1, { timeout: 20_000 });
    await expect(save).toBeVisible();
    await expect(save).toBeEnabled();

    // Discard via reload — the form re-seeds from the backend, so the probe
    // edit never persists and the shared owner state is untouched.
    await page.reload();
    const reloadedField = page.getByLabel(t('settings.account.profile.name'));
    await expect(reloadedField).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    await expect(reloadedField).toHaveValue(originalName, { timeout: 20_000 });
  });

  test('chat: the composer renders and is enabled at mobile width', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/chat`);

    // The composer textarea is not viewport-gated; it must render and accept
    // input at phone width with the seeded fixture agent available.
    const composer = page.getByRole('textbox', {
      name: t('chat.aria.chatInput'),
    });
    await expect(composer).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT });
    await expect(composer).toBeEnabled();
  });

  test('list page: customers renders usably at mobile width', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/customers`);

    // The seeded org ships no customers, so the list settles into either its
    // always-present writer action menu OR its empty-state — mirrors
    // `knowledge.spec.ts`'s settle wait so we never assert mid-skeleton. Both
    // prove the table chrome rendered (and is reachable) at phone width.
    const actionMenu = page.getByRole('button', {
      name: t('customers.importMenu.importCustomers'),
    });
    const emptyState = page.getByText(t('emptyStates.customers.title'));
    await expect(actionMenu.or(emptyState).first()).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
  });
});
