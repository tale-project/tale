import {
  composer,
  deleteThreadById,
  expectCannedReply,
  sendNewThreadMessage,
} from '../helpers/chat';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { SEEDED_PROMPT_TITLE } from '../helpers/seed';

/**
 * Thread lifecycle (send → reopen by URL → delete) and the seeded prompt
 * library listing. Thread title is backend-auto-generated, so selectors key on
 * the captured thread id, never the title.
 */

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

test('starts a thread, reopens it by URL, then deletes it', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/chat`);

  const message = `E2E thread probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  await expectCannedReply(page);

  // Open the history sidebar and confirm the populated "Chats" section renders.
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();
  await expect(
    page.getByText(t('chat.chatsSection'), { exact: true }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Leave the thread via the side-nav "New chat" rail link (the header button
  // was removed; new chat now lives on the rail + a global shortcut). The rail
  // links are icon-only, so scope to the nav landmark and target the chat href.
  // Then re-open by URL — a deterministic "open from history" that doesn't
  // depend on the auto-generated title.
  await page
    .getByRole('navigation', { name: t('common.aria.mainNavigation') })
    .locator(`a[href$="/dashboard/${organizationId}/chat"]`)
    .first()
    .click();
  await page.waitForURL(/\/chat(?:[/?#]|$)/, { timeout: TIMEOUT.NAV });

  await page.goto(`/dashboard/${organizationId}/chat/${threadId}`);
  await page.waitForURL(THREAD_URL, { timeout: TIMEOUT.NAV });
  // The prior user message rehydrating proves the thread reopened.
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  await deleteThreadById(page, threadId);
});

test('the seeded prompt is listed in the prompt library', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // With an empty composer the bookmark button opens the Prompt Library
  // directly (#2166); the Save-options menu only appears once there's a draft
  // worth saving. A fresh chat starts empty, so click the direct button.
  await page
    .getByRole('button', { name: t('chat.promptLibrary') })
    .first()
    .click();

  await expect(
    page.getByRole('dialog').filter({
      has: page.getByText(t('prompts.library.title'), { exact: true }),
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // The seeded autoInstall prompt is listed by its fixture title.
  await expect(
    page.getByText(SEEDED_PROMPT_TITLE, { exact: true }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
});
