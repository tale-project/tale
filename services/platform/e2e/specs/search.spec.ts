import { expect, test } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Chat search command-palette flow. The platform's command palette is the
 * shared `@tale/ui` `SearchCommand` mounted in the chat header
 * (`app/features/chat/components/chat-header.tsx`); it's wired to a *threads*
 * source — a query ≥2 chars runs a backend search over chat **message
 * content** and surfaces matching threads. (There is no cross-entity/global
 * palette in the app, so this does NOT search agents.)
 *
 * To give the palette a deterministic match on the shared backend, this spec
 * first creates a thread carrying a unique marker, then opens the palette and
 * searches for that marker. The marker lives in the user's own message, which
 * is stored regardless of LLM mode, so the result assertion holds in both mock
 * and live modes. The palette is opened via the header search button (stable
 * across OS) rather than the Cmd/Ctrl+K shortcut, and closed with Escape (the
 * close button's label comes from the `@tale/ui` `search` namespace, which the
 * spec's `t()` — reading only the service catalog — can't resolve).
 */

const SEARCH_MARKER = `zqxsearch${Date.now().toString(36)}`;
const SEED_MESSAGE = `Searchable probe ${SEARCH_MARKER} for the palette`;

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

test('opens the chat command palette, finds a thread, and closes', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);

  // --- Seed a thread whose message contains the unique marker. ---
  const composer = page.getByRole('textbox', {
    name: t('chat.aria.chatInput'),
  });
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(composer).toBeEnabled();

  // Draft-key flip retry — see `chat.spec.ts` for the full rationale.
  await composer.click();
  await expect(async () => {
    await composer.fill('');
    await composer.pressSequentially(SEED_MESSAGE);
    await expect(composer).toHaveValue(SEED_MESSAGE);
  }).toPass({ timeout: 30_000 });

  await page.getByRole('button', { name: t('chat.send'), exact: true }).click();

  // Thread created (URL gains an id) and the user message is persisted.
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  await expect(page.getByText(SEED_MESSAGE).first()).toBeVisible({
    timeout: 30_000,
  });

  // --- Open the palette and search for the marker. ---
  await page
    .getByRole('button', { name: t('chat.searchChat') })
    .first()
    .click();

  // The palette mounts a combobox input (aria-label = the search placeholder).
  const searchInput = page.getByRole('combobox', {
    name: t('dialogs.searchChat.placeholder'),
  });
  await expect(searchInput).toBeVisible({ timeout: 60_000 });

  // A ≥2-char query runs the message-content search; the marker is unique to
  // the thread just created, so its thread surfaces as a result. Retry the type
  // to absorb any indexing lag on the freshly written message.
  await expect(async () => {
    await searchInput.fill('');
    await searchInput.fill(SEARCH_MARKER);
    await expect(
      page.getByRole('listbox', { name: t('dialogs.searchChat.title') }),
    ).toBeVisible();
    await expect(
      page.getByRole('option').filter({ hasText: SEARCH_MARKER }).first(),
    ).toBeVisible();
  }).toPass({ timeout: 60_000 });

  // Close the palette with Escape (Radix Dialog dismiss).
  await page.keyboard.press('Escape');
  await expect(searchInput).toBeHidden({ timeout: 60_000 });
});
