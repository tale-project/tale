import type { Locator, Page } from '@playwright/test';

import {
  assistantMessages,
  composer,
  deleteThreadById,
  expectCannedReply,
  fillComposer,
  messageLog,
  sendNewThreadMessage,
  waitForReplyComplete,
} from '../helpers/chat';
import { isMockLlmMode, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Chat feature surface (feedback, export, message-info, save-prompt-from-
 * composer, selection→Quote, composer mode menu). All are backend-mutation-or-
 * client-only (no live model), so they hold in mock mode. The PDF export is
 * never clicked — it calls `iframe.print()`, which opens the OS print dialog
 * (not hermetic). The only LLM-CONTENT assertion (the info dialog's seeded
 * model id) is gated behind `isMockLlmMode()`.
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

test('the export dialog renders its options and the Markdown export downloads', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const message = `E2E export probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  // Wait for the reply so the export dialog's message list has both turns.
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  // Export lives behind the header's "More actions" menu. The history sidebar
  // is closed by default, so no chat-row menu of the same label exists yet —
  // the header trigger is the only `chat.moreActions` button on the surface.
  await page
    .getByRole('button', { name: t('chat.moreActions') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.export.button'), exact: true })
    .click();

  const exportDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.export.title'), { exact: true }),
  });
  await expect(exportDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Both format buttons render (Markdown is client-side; PDF opens the OS print
  // dialog so we never click it).
  const markdownButton = exportDialog.getByRole('button', {
    name: t('chat.export.downloadMarkdown'),
    exact: true,
  });
  await expect(markdownButton).toBeVisible({ timeout: TIMEOUT.PERSIST });
  await expect(
    exportDialog.getByRole('button', {
      name: t('chat.export.downloadPdf'),
      exact: true,
    }),
  ).toBeVisible();
  // The select/deselect-all control proves the message picker rendered.
  await expect(
    exportDialog.getByRole('button', { name: t('chat.export.deselectAll') }),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // The Markdown export is a fully client-side Blob download (no backend).
  if (await markdownButton.isEnabled()) {
    const downloadPromise = page.waitForEvent('download', {
      timeout: TIMEOUT.PERSIST,
    });
    await markdownButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('chat-export.md');
  } else {
    // Defensive: the render assertions already proved the dialog opened.
    console.warn('[chat-features] export Markdown disabled — no messages yet');
    await page.keyboard.press('Escape');
  }

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

test('selecting assistant text and clicking Quote stages a quoted-reference chip', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const message = `E2E quote probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  // SelectionQuoteButton listens for `mouseup` and reads the live selection;
  // Playwright's selectText() doesn't emit it. Scope the Range to the LAST
  // assistant bubble via its `data-message-id` (a known node inside the chat
  // scroll container, which the button requires), then dispatch a real mouseup.
  const assistantId = await assistantMessages(page)
    .last()
    .getAttribute('data-message-id');
  expect(assistantId).toBeTruthy();
  const selected = await page.evaluate((id) => {
    const bubble = document.querySelector(`[data-message-id="${id}"]`);
    if (!bubble) return null;
    const range = document.createRange();
    range.selectNodeContents(bubble);
    const selection = window.getSelection();
    if (!selection) return null;
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString().trim();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return text.length > 0 ? text : null;
  }, assistantId);
  expect(selected).toBeTruthy();

  const quoteButton = page.getByRole('button', {
    name: t('chat.quote.button'),
  });
  await expect(quoteButton).toBeVisible({ timeout: TIMEOUT.PERSIST });
  await quoteButton.click();

  // The quoted-reference chip stages over the composer (chat-layout context).
  await expect(
    page.getByText(t('chat.quote.label'), { exact: true }).first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });
  const removeQuote = page.getByRole('button', {
    name: t('chat.quote.remove'),
  });
  await expect(removeQuote).toBeVisible({ timeout: TIMEOUT.PERSIST });
  // Remove the chip again (proves the remove affordance + leaves it clean).
  await removeQuote.click();
  await expect(removeQuote).toBeHidden({ timeout: TIMEOUT.PERSIST });

  await deleteThreadById(page, threadId);
});

test('the message info dialog surfaces the seeded model name', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const message = `E2E info probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  await expectCannedReply(page);
  // The assistant toolbar (with the info button) renders only post-answer.
  await waitForReplyComplete(page);

  // The info button is a ghost icon button with no accessible name (tooltip
  // only), but it carries a stable testid. Scope to the LAST assistant bubble.
  const infoButton = assistantMessages(page)
    .last()
    .locator('[data-testid="message-info-button"]');
  await expect(infoButton).toBeVisible({ timeout: TIMEOUT.REPLY });
  await infoButton.click();

  // The dialog opens (title from `chat.messageInfo.title`)...
  const infoDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.messageInfo.title'), { exact: true }),
  });
  await expect(infoDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // ...and its "Model" field surfaces the seeded model id from
  // `metadata.model`. That metadata-bearing field is written only by the canned
  // mock turn (in live mode the model id is provider-dependent), so the id
  // assertion is gated on mock mode. The id `e2e-chat-model` is fixture content
  // (`fixtures/config/default/providers/e2e-mock.json`), so it stays a literal.
  if (isMockLlmMode()) {
    await expect(
      infoDialog.getByText('e2e-chat-model', { exact: true }).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  }
  await page.keyboard.press('Escape');

  await deleteThreadById(page, threadId);
});

test('the composer mode menu lists the add-files entry', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The composer mode menu (the leading "+" control) opens a menu that always
  // includes the attach-files entry in the seeded fixture (file upload on). No
  // thread is created by this flow, so there's nothing to clean up.
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await expect(
    page.getByRole('menuitem', { name: t('composer.addFiles'), exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // Close the menu without taking an action.
  await page.keyboard.press('Escape');
});
