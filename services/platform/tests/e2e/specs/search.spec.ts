import { deleteThreadById, sendNewThreadMessage } from '../helpers/chat';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Chat-scoped palette thread search. The palette (shared `SearchCommand`,
 * mounted at shell level as `ChatSearchCommand`) is wired to a chats-only
 * source: a query ≥2 chars runs a backend search over message content and
 * surfaces matching threads. To get a deterministic match, the spec seeds a
 * thread carrying a unique marker, then searches for it. The marker lives in
 * the user's own message (stored regardless of LLM mode), so the assertion
 * holds in mock and live modes. The palette is opened from the thread list's
 * search trigger (stable across OS) and closed with Escape (its close-button
 * label is in the `@tale/ui` search namespace, which the service-only `t()`
 * can't resolve). The org-wide ⌘K palette is a separate surface.
 *
 * FIXME(rewrite): seeding the thread requires a chat SEND, and the composer
 * disables Send until a model is available — which under the AI-backend
 * rewrite requires an org provider credential (`chat/composer.ts` lists only
 * credentialed connectors). The hermetic suite has no provider harness yet:
 * the interim scaffolder no longer seeds org-custom connectors (the
 * `providers` config domain is unregistered), the connector schema is
 * https-only (the mock gateway is loopback http), and no credential bootstrap
 * exists. Un-fixme when the e2e provider harness lands.
 */

test.fixme('opens the chat command palette, finds a thread, and closes', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/chat`);

  const marker = `zqxsearch${Date.now().toString(36)}`;
  const seedMessage = `Searchable probe ${marker} for the palette`;

  // Seed a thread whose user message contains the unique marker.
  const threadId = await sendNewThreadMessage(page, seedMessage);

  try {
    // Open the palette from the thread list's search trigger (first in DOM;
    // the mobile bar's copy is display:none on this desktop viewport).
    await page
      .getByRole('button', { name: t('chat.searchPalette.title') })
      .first()
      .click();

    const searchInput = page.getByRole('combobox', {
      name: t('chat.searchPalette.placeholder'),
    });
    await expect(searchInput).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // A ≥2-char query runs the message-content search; the marker is unique to
    // the just-created thread, so its thread surfaces. Retry to absorb any
    // indexing lag on the freshly written message.
    await expect(async () => {
      await searchInput.fill('');
      await searchInput.fill(marker);
      await expect(
        page.getByRole('listbox', { name: t('chat.searchPalette.title') }),
      ).toBeVisible();
      await expect(
        page.getByRole('option').filter({ hasText: marker }).first(),
      ).toBeVisible();
    }).toPass({ timeout: TIMEOUT.REPLY });

    // Close the palette with Escape (Radix Dialog dismiss).
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeHidden({ timeout: TIMEOUT.VISIBLE });
  } finally {
    await deleteThreadById(page, threadId);
  }
});
