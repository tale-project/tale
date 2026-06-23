import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Token sources CRUD round-trip (Settings > Token Sources): create a source,
 * see it in the list, then delete it so the worker's isolated org is left as it
 * was found. Auth method is set to "None" so the create needs no broker secret,
 * and saving only writes config (the broker is contacted at agent-run time, not
 * here) — so the flow is deterministic without a mock broker.
 */

function settingsUrl(organizationId: string): string {
  return `/dashboard/${organizationId}/settings/token-sources`;
}

test.describe('token sources', () => {
  test('creates a token source, lists it, and deletes it', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId));

    // The SettingsSection title is the page's first content (h2).
    await expect(
      page.getByRole('heading', {
        name: t('navigation.tokenSources'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const suffix = Date.now().toString(36);
    const slug = `e2e-${suffix}`;
    const displayName = `E2E Token Source ${suffix}`;

    // Open the create side panel (the trigger button shares its label with the
    // sheet title, so scope subsequent field lookups to the dialog).
    await page
      .getByRole('button', {
        name: t('settings.tokenSources.new'),
        exact: true,
      })
      .click();

    const dialog = page.getByRole('dialog', {
      name: t('settings.tokenSources.newTitle'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    await dialog.getByLabel(t('settings.tokenSources.slug')).fill(slug);
    await dialog
      .getByLabel(t('settings.tokenSources.displayName'))
      .fill(displayName);
    await dialog
      .getByLabel(t('settings.tokenSources.endpoint'))
      .fill('https://broker.example.com/api/tokens');

    // Set broker auth to "None" so no secret is required for the create.
    await dialog
      .getByRole('combobox', { name: t('settings.tokenSources.authMethod') })
      .click();
    await page
      .getByRole('option', {
        name: t('settings.tokenSources.authNone'),
        exact: true,
      })
      .click();

    await dialog
      .getByRole('button', {
        name: t('settings.tokenSources.save'),
        exact: true,
      })
      .click();

    // Commit gate: the manager toasts `saved` and closes the panel on success.
    await expect(
      page.getByText(t('settings.tokenSources.saved')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The new source shows up in the list.
    await expect(page.getByText(displayName).first()).toBeVisible({
      timeout: TIMEOUT.PERSIST,
    });

    // Clean up: delete it via the row ··· menu, confirm, and wait for the toast
    // so the isolated org is left empty for re-runs.
    await page
      .getByRole('button', { name: t('settings.tokenSources.actions') })
      .first()
      .click();
    await page
      .getByRole('menuitem', { name: t('settings.tokenSources.delete') })
      .click();

    const confirm = page.getByRole('dialog', {
      name: t('settings.tokenSources.deleteTitle'),
    });
    await expect(confirm).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await confirm
      .getByRole('button', {
        name: t('settings.tokenSources.delete'),
        exact: true,
      })
      .click();

    await expect(
      page.getByText(t('settings.tokenSources.deleted')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(page.getByText(displayName)).toHaveCount(0, {
      timeout: TIMEOUT.PERSIST,
    });
  });
});
