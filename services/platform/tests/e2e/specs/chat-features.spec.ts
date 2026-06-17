import type { Locator, Page } from '@playwright/test';

import {
  composer,
  deleteThreadById,
  expectCannedReply,
  fillComposer,
  messageLog,
  sendNewThreadMessage,
  waitForReplyComplete,
} from '../helpers/chat';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Chat feature surface that genuinely needs the real stack: feedback (backend
 * RBAC round-trip) and save-prompt-from-composer (real persist seam). The
 * pure-UI surfaces — export dialog, message-info dialog, composer mode menu,
 * and selection→Quote — moved to component tests (`export-chat-dialog`/
 * `message-info-dialog`/`composer-mode-menu`/`selection-quote` `.test.tsx`).
 */

/** The completed assistant reply's "Helpful" thumbs-up (renders post-answer). */
function thumbsUp(page: Page): Locator {
  return messageLog(page)
    .getByRole('button', { name: t('chat.feedback.thumbsUp') })
    .last();
}

test('thumbs-up latches and toggles off; thumbs-down latches and opens the comment box', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const message = `E2E feedback probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  await expectCannedReply(page);
  // The feedback toolbar renders only after the answer fully reveals.
  await waitForReplyComplete(page);

  const up = thumbsUp(page);
  const down = messageLog(page)
    .getByRole('button', { name: t('chat.feedback.thumbsDown') })
    .last();
  await expect(up).toBeVisible({ timeout: TIMEOUT.REPLY });

  // The selected rating is reflected via `aria-pressed` — the mutation-
  // confirmed signal (the green fill is just a class).
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true', {
    timeout: TIMEOUT.PERSIST,
  });

  // Clicking the active thumbs-up again removes the feedback (deleteFeedback).
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'false', {
    timeout: TIMEOUT.PERSIST,
  });

  // Thumbs-down latches and reveals the negative-feedback comment box.
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true', {
    timeout: TIMEOUT.PERSIST,
  });
  await expect(
    messageLog(page).getByRole('textbox', {
      name: t('chat.feedback.commentPlaceholder'),
    }),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // Toggle the negative rating back off (cleanup of the feedback row).
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'false', {
    timeout: TIMEOUT.PERSIST,
  });

  await deleteThreadById(page, threadId);
});

test('saves a composer draft as a prompt, finds it in the library, then deletes it', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Unique CONTENT (not title) — the saved prompt's title is AI-generated, so
  // we locate the row by content. No thread is created by this flow.
  const promptContent = `E2E saved prompt probe ${Date.now().toString(36)}`;

  // Seed the composer so "Save prompt draft" is enabled (non-empty gate).
  await fillComposer(page, promptContent);

  await page
    .getByRole('button', { name: t('chat.savePromptMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.savePromptDraft'), exact: true })
    .click();

  // The SavePromptDialog opens pre-filled; set content directly (plain control,
  // no draft-key flip) and save (default scope = Personal → valid).
  const saveDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('prompts.saveAs.title'), { exact: true }),
  });
  await expect(saveDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  const contentBox = saveDialog.getByRole('textbox', {
    name: t('prompts.form.contentLabel'),
  });
  await expect(contentBox).toBeVisible({ timeout: TIMEOUT.PERSIST });
  await contentBox.fill(promptContent);
  await expect(contentBox).toHaveValue(promptContent);
  await saveDialog
    .getByRole('button', { name: t('prompts.form.save'), exact: true })
    .click();
  await expect(saveDialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });

  // Open the Prompt Library and search for the prompt by its unique content.
  await page
    .getByRole('button', { name: t('chat.savePromptMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.promptLibrary'), exact: true })
    .click();
  const libraryDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('prompts.library.title'), { exact: true }),
  });
  await expect(libraryDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // NOTE: the library search matches title/description/category/tags only —
  // content is intentionally excluded (see `listPrompts`), and the title here
  // is AI-generated/unknown — so we can't filter by our unique content string.
  // The just-saved prompt is newest-first, so locate its row directly: the row
  // renders `prompt.content`, making the unique content the reliable anchor.
  const promptRow = libraryDialog
    .getByRole('listitem')
    .filter({ has: page.getByText(promptContent, { exact: true }) })
    .first();
  await expect(promptRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Delete it (cleanup): row "More actions" → Delete → confirm.
  await promptRow
    .getByRole('button', { name: t('prompts.actions.more') })
    .click();
  await page
    .getByRole('menuitem', { name: t('prompts.actions.delete'), exact: true })
    .click();
  await page
    .getByRole('button', { name: t('prompts.actions.delete'), exact: true })
    .click();
  await expect(promptRow).toBeHidden({ timeout: TIMEOUT.VISIBLE });
});
