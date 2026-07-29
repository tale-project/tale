import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Core (non-governance) settings flows: the account display-name round-trip and
 * the two credential catalogs — AI providers and connectors — where the cards
 * render, the toolbar narrows them, and a card opens its detail dialog. Only the
 * account test writes; it captures and restores its original value so the
 * worker's isolated org is left as it was found.
 */

// Anchors that ship with the platform (`configs/platform/system/{providers,
// connectors}/*/`) — always present, independent of org data. Each renders as
// its card's heading. Config literals, kept local (not via `t()`).
const SHIPPED_PROVIDER_DISPLAY_NAME = 'Anthropic';
const SHIPPED_CONNECTOR_DISPLAY_NAME = 'GitHub';

function settingsUrl(organizationId: string, path: string): string {
  return `/dashboard/${organizationId}/settings/${path}`;
}

// The unified Save/Discard cluster renders twice (a desktop `hidden md:flex`
// slot + a `md:hidden` mobile bar), so the Save button matches two DOM nodes;
// scope to the one visible on the Desktop Chrome viewport.
function visibleSaveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

test.describe('core settings', () => {
  test('account: edits, persists, and restores the display name', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'account'));

    // The Profile section heading is the page's first content (no page title).
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // Target the input by role: SettingsRow names a wrapper div with the same
    // text, so getByLabel would resolve to both the div and the control.
    const nameField = page.getByRole('textbox', {
      name: t('settings.account.profile.name'),
    });
    await expect(nameField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(nameField).toBeEnabled();

    const originalName = await nameField.inputValue();
    const newName = `E2E Owner ${Date.now().toString(36)}`;
    expect(newName).not.toBe(originalName);

    // Editing makes the form dirty, which enables the Save cluster.
    await nameField.fill(newName);
    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Commit gate: wait for the Save cluster to settle BEFORE reloading. The
    // reload navigation aborts any in-flight save request, so reloading before
    // the mutation has committed would race it (the reloaded field shows the
    // original value). The page toasts nothing on success — the cluster flashes
    // "Saved" and settles back to a DISABLED "Save" once the form is clean
    // again, which is the commit signal. Persistence is asserted off the
    // reloaded FIELD below.
    await expect(save).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(newName, { timeout: TIMEOUT.PERSIST });

    // Unconditionally restore the original value (keeps re-runs deterministic).
    await nameField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await restoreSave.click();
    await expect(restoreSave).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(originalName, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('providers: lists the shipped providers as cards and opens one', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'providers'));

    // The catalog comes from ONE Convex action that fetches live model catalogs
    // (OpenRouter, the Vercel gateway) before it resolves, and the grid shows
    // shape-matched skeletons until then. With no egress those fetches have to
    // time out first, so this needs the execution budget, not the element one.
    // The card's title is a real heading, so it needs no interpolated label —
    // and the heading is what a screen-reader user navigates by anyway.
    const cardTitle = page.getByRole('heading', {
      name: SHIPPED_PROVIDER_DISPLAY_NAME,
      level: 3,
    });
    await expect(cardTitle).toBeVisible({ timeout: TIMEOUT.EXECUTION });
    const card = page.getByRole('button').filter({ has: cardTitle });

    // The toolbar's own controls, which are what make twelve providers usable.
    await expect(
      page.getByRole('tab', { name: t('settings.providers.tabs.all') }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder(t('settings.providers.searchPlaceholder')),
    ).toBeVisible();

    // Opening a card puts the provider in the URL and shows its credentials.
    await card.click();
    const detail = page.getByRole('dialog', {
      name: SHIPPED_PROVIDER_DISPLAY_NAME,
    });
    await expect(detail).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(page).toHaveURL(/[?&]provider=/);

    // Read-only: open the add dialog and dismiss it without creating anything.
    await detail
      .getByRole('button', { name: t('settings.credentials.addCredential') })
      .click();
    const addDialog = page.getByRole('dialog', {
      name: t('settings.credentials.addTitle'),
    });
    await expect(addDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.keyboard.press('Escape');
    await expect(addDialog).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });

  test('connectors: lists the shipped connectors and narrows them', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'connectors'));

    // The catalog action reads the shipped connector files off disk — no egress,
    // so this resolves on the element budget rather than the execution one.
    const cardTitle = page.getByRole('heading', {
      name: SHIPPED_CONNECTOR_DISPLAY_NAME,
      level: 3,
    });
    await expect(cardTitle).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    const card = page.getByRole('button').filter({ has: cardTitle });

    // Search narrows the grid client-side over the loaded catalog.
    const search = page.getByPlaceholder(
      t('settings.connectors.searchPlaceholder'),
    );
    await search.fill('zzzz-no-connector-matches-this');
    await expect(cardTitle).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // Narrowed to nothing offers the search reset, never a create CTA.
    await expect(page.getByText(t('common.search.noResults'))).toBeVisible();
    await search.clear();
    await expect(cardTitle).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // A card opens its dialog and records itself in the URL.
    await card.click();
    await expect(
      page.getByRole('dialog', { name: SHIPPED_CONNECTOR_DISPLAY_NAME }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(page).toHaveURL(/[?&]connector=/);
  });
});
