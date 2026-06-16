import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Core (non-governance) settings smoke flows. Runs as the pre-authenticated
 * owner (chromium project storageState) against the seeded org.
 *
 * Coverage:
 *  - Account profile — change the display name, save via the unified Save
 *    cluster, assert the success toast, reload to prove persistence, then
 *    RESTORE the original value so the spec is idempotent across runs.
 *  - Organization — the page loads and the name field holds the current org
 *    name (read-only; never mutated here).
 *  - Providers — the list shows the seeded "E2E Mock Provider"; its detail
 *    deep-link opens the provider drawer.
 *  - Page-loads matrix — every remaining core settings page renders its
 *    primary section heading without error (read-only).
 *
 * Idempotency: only the profile flow writes, and it restores the original
 * value. Everything else is a read. Governance pages are owned by
 * `governance-settings.spec.ts` and are intentionally excluded here.
 *
 * Settings pages have NO page title — the rail/tab names the page and content
 * starts with a `SettingsSection` `<h2>` heading — so every assertion targets a
 * SECTION heading (role `heading`), never a page title.
 */

// Seeded fixture provider, defined in
// `fixtures/config/default/providers/e2e-mock.json`. The provider's `name`
// (used in the detail URL) is the filename basename; `displayName` is the
// table label. Fixture literals, not translated UI copy — rename-safety, so
// they stay local constants rather than going through `t()`.
const PROVIDER_SLUG = 'e2e-mock';
const PROVIDER_DISPLAY_NAME = 'E2E Mock Provider';

function settingsUrl(organizationId: string, path: string): string {
  return `/dashboard/${organizationId}/settings/${path}`;
}

/**
 * The unified Save/Discard cluster is rendered TWICE in the settings layout —
 * a desktop slot (`hidden md:flex`) and a mobile bar (`md:hidden`) — so the
 * Save button matches two nodes in the DOM. On the Desktop Chrome viewport only
 * one is visible; scope to it so the locator is unambiguous.
 */
function visibleSaveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

test.describe('core settings', () => {
  test('account: edits, persists, and restores the display name', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'account'));

    // The Profile section heading is the page's first content (no page title).
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    const nameField = page.getByLabel(t('settings.account.profile.name'));
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await expect(nameField).toBeEnabled();

    // Capture the original value so the run is restorable (the owner's display
    // name is shared backend state).
    const originalName = await nameField.inputValue();
    const newName = `E2E Owner ${Date.now().toString(36)}`;
    expect(newName).not.toBe(originalName);

    // Editing makes the form dirty, which mounts/enables the Save cluster.
    await nameField.fill(newName);
    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();

    await expect(
      page.getByText(t('toast.success.profileUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Reload: the new value must come back from the backend, not local state.
    await page.reload();
    const reloadedField = page.getByLabel(t('settings.account.profile.name'));
    await expect(reloadedField).toBeVisible({ timeout: 60_000 });
    await expect(reloadedField).toHaveValue(newName, { timeout: 20_000 });

    // Restore the original value (keeps re-runs deterministic).
    await reloadedField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: 20_000 });
    await restoreSave.click();
    await expect(
      page.getByText(t('toast.success.profileUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(reloadedField).toHaveValue(originalName);
  });

  test('organization: page loads and shows the current org name', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'organization'));

    await expect(
      page.getByRole('heading', {
        name: t('settings.organization.detailsTitle'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The org name field is read-only here (never mutated) — assert it loaded a
    // non-empty value rather than a specific name, since a local re-run reuses
    // whatever org the setup created.
    const orgNameField = page.getByLabel(t('settings.organization.title'));
    await expect(orgNameField).toBeVisible({ timeout: 60_000 });
    await expect(orgNameField).not.toHaveValue('', { timeout: 20_000 });
  });

  test('providers: lists the seeded provider and opens its detail drawer', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'providers'));

    // Section heading (the providers list title), then the seeded provider row.
    await expect(
      page.getByRole('heading', {
        name: t('navigation.providers'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(PROVIDER_DISPLAY_NAME).first()).toBeVisible({
      timeout: 60_000,
    });

    // The detail page is a preserved deep-link that re-renders the list with
    // the provider drawer auto-opened. Assert the drawer's "General" section,
    // and that it shows the seeded provider's display name.
    await page.goto(settingsUrl(organizationId, `providers/${PROVIDER_SLUG}`));
    await expect(
      page.getByRole('heading', {
        name: t('settings.providers.general'),
        level: 3,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(PROVIDER_DISPLAY_NAME).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});

/**
 * Page-loads matrix: each remaining core settings page renders its primary
 * section heading without error. `heading` is `<h2>` (a `SettingsSection`
 * title) for every entry except the provider drawer; the section title — not a
 * page title — names each page. `account`/`organization` are exercised in
 * depth above and re-checked here purely as a render smoke (read-only).
 *
 * `people` and `api` (index) are redirect stubs — `people` → `teams`,
 * `api` → `api/rest` — so they land on, and assert, the target page's heading.
 */
const PAGE_LOADS: ReadonlyArray<{
  name: string;
  path: string;
  heading: string;
}> = [
  { name: 'branding', path: 'branding', heading: t('navigation.branding') },
  {
    name: 'personalization',
    path: 'personalization',
    heading: t('personalization.page.title'),
  },
  { name: 'api index (→ rest)', path: 'api', heading: t('navigation.apiKeys') },
  { name: 'api rest', path: 'api/rest', heading: t('navigation.apiKeys') },
  { name: 'api mcp', path: 'api/mcp', heading: t('navigation.mcp') },
  {
    name: 'api webdav',
    path: 'api/webdav',
    heading: t('webdav.connectionDetails.title'),
  },
  {
    name: 'api runtimes',
    path: 'api/runtimes',
    heading: t('runtimes.install.title'),
  },
  { name: 'people (→ teams)', path: 'people', heading: t('navigation.teams') },
  { name: 'teams', path: 'teams', heading: t('navigation.teams') },
  {
    name: 'integrations',
    path: 'integrations',
    heading: t('navigation.integrations'),
  },
  {
    name: 'account',
    path: 'account',
    heading: t('settings.account.profile.title'),
  },
  {
    name: 'organization',
    path: 'organization',
    heading: t('settings.organization.detailsTitle'),
  },
];

test.describe('core settings page loads', () => {
  for (const { name, path, heading } of PAGE_LOADS) {
    test(`renders ${name}`, async ({ page }) => {
      const { organizationId } = readRunContext();
      await page.goto(settingsUrl(organizationId, path));

      // The primary section heading proves the page mounted and resolved its
      // data (sections render their title only once the route component runs).
      await expect(
        page.getByRole('heading', { name: heading, level: 2 }).first(),
      ).toBeVisible({ timeout: 60_000 });
    });
  }
});
