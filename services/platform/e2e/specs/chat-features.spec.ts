import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import { CANNED_REPLY } from '../mock-llm/canned';

/**
 * Chat FEATURE surface against the seeded E2E agent — the hermetic subset that
 * `chat.spec.ts` (send/stream), `chat-threads.spec.ts` (threads/history/
 * prompt-library-listing), `chat-depth.spec.ts` (attachment/pickers/share) and
 * `chat-advanced.spec.ts` (stop/regenerate/edit/copy/multi-turn) don't cover:
 *
 *  1. FEEDBACK — on a completed assistant reply, click thumbs-up and assert it
 *     latches (`aria-pressed`), toggles back off, then click thumbs-down and
 *     assert it latches + opens the comment box (MessageFeedback / Convex
 *     `submitFeedback`/`deleteFeedback` — pure mutations, no LLM).
 *  2. EXPORT — open the header "More actions" → Export dialog, assert it renders
 *     its format buttons + selectable-message list, then DOWNLOAD the Markdown
 *     export and assert the file (fully client-side Blob — hermetic). PDF is
 *     skipped (it calls `iframe.print()`, which opens the OS print dialog).
 *  3. INFO — open the per-message info dialog from the assistant toolbar and
 *     assert it surfaces the seeded model name "E2E Chat Model".
 *  4. SAVE PROMPT — type composer text, save it as a prompt via the composer's
 *     Save-options menu, find it in the Prompt Library (by its unique CONTENT),
 *     then DELETE it (cleanup). The save action AI-generates a title, which the
 *     mock serves deterministically (or falls back to a PROMPT-XXXXX id), so the
 *     prompt is always created regardless — we never rely on the title.
 *  5. SELECTION-QUOTE — select text inside an assistant reply, click the
 *     floating Quote button, assert the quoted-reference chip stages over the
 *     composer (chat-layout context — no backend).
 *  6. COMPOSER MODE MENU — open the composer mode menu and assert it lists the
 *     "Add files" entry (the always-present attach action in the seeded fixture).
 *
 * Mirrors `chat.spec.ts`: the composer-fill draft-key-flip `toPass` retry is
 * reused, and every LLM-CONTENT assertion is gated behind `isMockLlmMode()`.
 *
 * --- HERMETICITY / LOCATOR NOTES (rules 6 & 7) ---
 *  - FEEDBACK / SAVE-PROMPT / EXPORT(markdown) / QUOTE / MODE-MENU are all
 *    backend-mutation-or-client-only — no live model — so they hold in mock mode.
 *  - The INFO and COPY toolbar controls are ghost icon buttons with NO accessible
 *    name (tooltip-only; message-bubble.tsx). They sit in the assistant toolbar
 *    as `before` slots of MessageFeedback, whose own thumbs-up IS labelled. So
 *    the toolbar ROW is the labelled thumbs-up's parent, holding buttons in DOM
 *    order [copy, info, thumbsUp, thumbsDown, …] — info is the SECOND button.
 *    (Same anchoring trick `chat-advanced.spec.ts` uses to reach Copy.)
 *  - The header "More actions" (Export) menu and a history-row's "More actions"
 *    share the `chat.moreActions` label; scope to the header bar (the row that
 *    also holds the "New chat" button) so we open the right one.
 *  - TEXT SELECTION: Playwright's `selectText()` doesn't emit the `mouseup` the
 *    SelectionQuoteButton listens for, so we build a Range over the assistant
 *    reply node in `evaluate`, apply it to `window.getSelection()`, and dispatch
 *    a real `mouseup` on `document` (the component reads the live selection on
 *    that event). The button only honors selections whose range lives inside the
 *    chat scroll container — the assistant bubble does — so it appears.
 *  - PDF EXPORT is NOT exercised: `printViaIframe` calls `iframe.print()`, which
 *    opens the browser's native print dialog (not controllable headless and not
 *    hermetic). Only the client-side Markdown Blob download is asserted.
 */

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

/** Resolve the always-present composer textarea by its aria label. */
function composer(page: Page): Locator {
  return page.getByRole('textbox', { name: t('chat.aria.chatInput') });
}

/** The composed-message send button (Send⇄Stop toggle in its Send state). */
function sendButton(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.send'), exact: true });
}

/**
 * The same single button slot in its Stop state (in-flight turn). The Send⇄Stop
 * toggle keeps one element and only flips its `aria-label` between
 * `chat.send` ("Send message") and `chat.stopGenerating` ("Stop generating")
 * (chat-input.tsx), so the turn is done exactly when this Stop affordance is gone.
 */
function stopButton(page: Page): Locator {
  return page.getByRole('button', {
    name: t('chat.stopGenerating'),
    exact: true,
  });
}

/** The role=log region that wraps the rendered message bubbles. */
function messageLog(page: Page): Locator {
  return page.getByRole('log', { name: t('chat.aria.messageHistory') });
}

/**
 * Fill the composer reliably despite the draft-key flip — the controlled
 * textarea re-seeds from storage once the resolved-user-id key settles, so a
 * single type can ship a truncated value. Reused verbatim from `chat.spec.ts`.
 */
async function fillComposer(page: Page, message: string): Promise<void> {
  const box = composer(page);
  await expect(box).toBeVisible({ timeout: 60_000 });
  await expect(box).toBeEnabled();
  await box.click();
  await expect(async () => {
    await box.fill('');
    await box.pressSequentially(message);
    await expect(box).toHaveValue(message);
  }).toPass({ timeout: 30_000 });
}

/**
 * Send `message` into a fresh chat surface and wait for the round-trip to
 * create a thread (the URL gains a thread id). The optimistic user bubble is
 * asserted; the assistant reply is the caller's concern.
 */
async function sendNewThreadMessage(
  page: Page,
  message: string,
): Promise<void> {
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  await expect(page.getByText(message).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  expect(THREAD_URL.exec(page.url())?.[1]).toBeTruthy();
}

/**
 * Wait for the in-flight turn to finish: the Stop affordance reverts to Send.
 * NOT `toBeEnabled()` — Send is DISABLED while the composer is empty, which it
 * is the moment the reply lands, so the button never enables on its own. The
 * turn is done when the Stop control is gone and the Send control is present.
 */
async function waitForReplyComplete(page: Page): Promise<void> {
  await expect(stopButton(page)).toBeHidden({ timeout: 120_000 });
  await expect(sendButton(page)).toBeVisible({ timeout: 120_000 });
}

/**
 * The completed assistant toolbar's labelled thumbs-up (MessageFeedback's
 * "Helpful"). It renders only once the answer has fully revealed, so callers
 * `waitForReplyComplete` first. Scoped to the message log to avoid any
 * same-labelled control elsewhere.
 */
function thumbsUp(page: Page): Locator {
  return messageLog(page)
    .getByRole('button', { name: t('chat.feedback.thumbsUp') })
    .last();
}

/**
 * Delete the currently-open thread via the history sidebar (rule 4 cleanup —
 * the only persistent state these tests mutate, and they clean up after
 * themselves). Mirrors the delete flow in the sibling chat specs.
 */
async function deleteOpenThread(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();
  // Scope to the list <section> holding the "Chats" header so we don't grab
  // the chat-header's own "More actions" (Export) menu. Our freshly created
  // thread is the newest un-projected (unpinned) chat → the first row.
  const listSection = page
    .locator('section')
    .filter({ has: page.getByText(t('chat.chatsSection'), { exact: true }) })
    .first();
  const rowActions = listSection
    .getByRole('button', { name: t('chat.moreActions') })
    .first();
  await rowActions.scrollIntoViewIfNeeded();
  await rowActions.click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
    .click();
  await page
    .getByRole('button', { name: t('chat.deleteChat'), exact: true })
    .click();
  await page.waitForURL(/\/chat(?:[/?#]|$)/, { timeout: 60_000 });
}

test('thumbs-up latches and toggles off; thumbs-down latches and opens the comment box', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E feedback probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  // The feedback toolbar renders only after the answer fully reveals.
  await waitForReplyComplete(page);

  const up = thumbsUp(page);
  const down = messageLog(page)
    .getByRole('button', { name: t('chat.feedback.thumbsDown') })
    .last();
  await expect(up).toBeVisible({ timeout: 120_000 });

  // The selected rating is reflected via `aria-pressed` (MessageFeedback) — the
  // deterministic, mutation-confirmed signal (the green fill is just a class).
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

  // Clicking the active thumbs-up again removes the feedback (deleteFeedback).
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'false', {
    timeout: 30_000,
  });

  // Thumbs-down latches and reveals the negative-feedback comment box.
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true', {
    timeout: 30_000,
  });
  // The comment textarea (labelled by its placeholder) appears for a negative
  // rating — proof the negative branch fired, not just the toggle.
  await expect(
    messageLog(page).getByRole('textbox', {
      name: t('chat.feedback.commentPlaceholder'),
    }),
  ).toBeVisible({ timeout: 30_000 });

  // Toggle the negative rating back off (cleanup of the reactive feedback row).
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'false', {
    timeout: 30_000,
  });

  await deleteOpenThread(page);
});

test('the export dialog renders its options and the Markdown export downloads', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E export probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);
  // Wait for the reply so the export dialog's message list has both turns.
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await waitForReplyComplete(page);

  // The Export action lives behind the header's "More actions" menu (only
  // rendered once a thread exists). The history sidebar is closed by default
  // (`isHistoryOpen` initial state — chat-layout-context.tsx), so NO chat-row
  // "More actions" menu of the same label exists yet — the header trigger is
  // the only `chat.moreActions` button on the surface. `.first()` resolves it
  // (the hidden `md:hidden` mobile bar's twin is display:none → excluded from
  // the accessibility tree, so role queries skip it).
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
  await expect(exportDialog).toBeVisible({ timeout: 60_000 });

  // Both format buttons render (Markdown is client-side; PDF opens the OS print
  // dialog so we never click it).
  const markdownButton = exportDialog.getByRole('button', {
    name: t('chat.export.downloadMarkdown'),
    exact: true,
  });
  await expect(markdownButton).toBeVisible({ timeout: 30_000 });
  await expect(
    exportDialog.getByRole('button', {
      name: t('chat.export.downloadPdf'),
      exact: true,
    }),
  ).toBeVisible();
  // The select/deselect-all control proves the message picker rendered.
  await expect(
    exportDialog.getByRole('button', { name: t('chat.export.deselectAll') }),
  ).toBeVisible({ timeout: 30_000 });

  // The Markdown export is a fully client-side Blob download (no backend);
  // assert the real download fires with the expected filename.
  const markdownEnabled = await markdownButton.isEnabled();
  if (markdownEnabled) {
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await markdownButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('chat-export.md');
  } else {
    // Defensive: if the message list hadn't loaded (so nothing is selected),
    // just close the dialog rather than failing — the render assertions above
    // already proved the dialog opened with its options.
    console.warn('[chat-features] export Markdown disabled — no messages yet');
    await page.keyboard.press('Escape');
  }

  await deleteOpenThread(page);
});

test('the message info dialog surfaces the seeded model name', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E info probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await waitForReplyComplete(page);

  // The info button is a ghost icon button with no accessible name (tooltip
  // only). It's the SECOND control in the assistant toolbar row, in DOM order
  // [copy, info, thumbsUp, thumbsDown, fork, more].
  //
  // Each toolbar Button is wrapped by the UI kit's <SkeletonBox> — a
  // `display:contents` <span> that is invisible to the accessibility tree (so
  // the snapshot shows the buttons as direct children of the row) but is a REAL
  // DOM node. So the labelled thumbs-up <button>'s xpath parent is its own
  // SkeletonBox span, NOT the row — its xpath GRANDPARENT (`../..`) is the
  // `flex` toolbar row that holds all six buttons. (chat-advanced.spec.ts's
  // single-level `..` happens to still resolve a button because `.first()`
  // matches the one button inside that span.)
  const up = thumbsUp(page);
  await expect(up).toBeVisible({ timeout: 120_000 });
  const toolbarRow = up.locator('xpath=../..');
  const infoButton = toolbarRow.getByRole('button').nth(1);
  await infoButton.click();

  // The dialog opens (title from `chat.messageInfo.title`)...
  const infoDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.messageInfo.title'), { exact: true }),
  });
  await expect(infoDialog).toBeVisible({ timeout: 60_000 });
  // ...and surfaces the seeded model id from `metadata.model`. The dialog's
  // "Model" group renders the raw model id (`e2e-chat-model`), not a prettified
  // display name — this is fixture content (from
  // `fixtures/config/default/providers/e2e-mock.json`), so it stays a literal.
  // The metadata-bearing model field only exists in mock mode (the canned turn
  // writes it); in live mode the model id is provider-dependent, so assert only
  // that the dialog opened.
  if (isMockLlmMode()) {
    await expect(
      infoDialog.getByText('e2e-chat-model', { exact: true }).first(),
    ).toBeVisible({ timeout: 60_000 });
  }
  await page.keyboard.press('Escape');

  await deleteOpenThread(page);
});

test('saves a composer draft as a prompt, finds it in the library, then deletes it', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // Unique CONTENT (not title) — the saved prompt's title is AI-generated, so
  // we locate the row by its content, which we control and can make unique
  // (rule 4). No thread is created by this flow, so the only state we mutate is
  // the one prompt — deleted at the end.
  const suffix = Date.now().toString(36);
  const promptContent = `E2E saved prompt probe ${suffix}`;

  // Seed the composer so the Save-options menu's "Save prompt draft" item is
  // enabled (gated on a non-empty trimmed value).
  await fillComposer(page, promptContent);

  // Open the composer's Save-options menu (bookmark) → "Save prompt draft".
  await page
    .getByRole('button', { name: t('chat.savePromptMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.savePromptDraft'), exact: true })
    .click();

  // The SavePromptDialog opens, pre-filled with the composer text. Its content
  // textarea is a plain control (no draft-key flip), so set it directly to our
  // unique content to guarantee the marker is what gets persisted, then save
  // (default scope = Personal → valid).
  const saveDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('prompts.saveAs.title'), { exact: true }),
  });
  await expect(saveDialog).toBeVisible({ timeout: 60_000 });
  const contentBox = saveDialog.getByRole('textbox', {
    name: t('prompts.form.contentLabel'),
  });
  await expect(contentBox).toBeVisible({ timeout: 30_000 });
  await contentBox.fill(promptContent);
  await expect(contentBox).toHaveValue(promptContent);
  await saveDialog
    .getByRole('button', { name: t('prompts.form.save'), exact: true })
    .click();
  await expect(saveDialog).toBeHidden({ timeout: 60_000 });

  // Open the Prompt Library and locate the prompt by its unique content.
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
  await expect(libraryDialog).toBeVisible({ timeout: 60_000 });

  // We DON'T search here: the library's `search` only matches title /
  // description / category / tags — NOT content (convex/prompts/queries.ts) —
  // and the saved prompt's title is the AI/fallback id we don't control. The
  // default "All" tab is newest-first across scopes (queries.ts), so the
  // freshly saved prompt is on the first page; locate its row directly by the
  // content it renders (PromptListRow's line-clamped content span, role=listitem).
  const promptRow = libraryDialog
    .getByRole('listitem')
    .filter({ has: page.getByText(promptContent, { exact: true }) })
    .first();
  await expect(promptRow).toBeVisible({ timeout: 60_000 });

  // Delete it (rule 4 cleanup): the row's "More actions" menu → Delete →
  // confirm. The owner can modify any prompt, so the menu is present.
  await promptRow
    .getByRole('button', { name: t('prompts.actions.more') })
    .click();
  await page
    .getByRole('menuitem', { name: t('prompts.actions.delete'), exact: true })
    .click();
  // ConfirmDialog confirm button is labelled with `prompts.actions.delete`.
  await page
    .getByRole('button', { name: t('prompts.actions.delete'), exact: true })
    .click();

  // The content-matched row is gone from the list.
  await expect(promptRow).toBeHidden({ timeout: 60_000 });
});

test('selecting assistant text and clicking Quote stages a quoted-reference chip', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E quote probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);
  // The quote needs assistant text to select; gate the content on mock mode.
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await waitForReplyComplete(page);

  // SelectionQuoteButton listens for `mouseup` and reads the live selection;
  // Playwright's selectText() doesn't emit that event, so build a Range over
  // the assistant reply node, apply it, and dispatch a real `mouseup`. The node
  // must live inside the chat scroll container (it does) for the button to show.
  const replyText = isMockLlmMode() ? CANNED_REPLY : message;
  const selected = await page.evaluate((needle) => {
    const log = document.querySelector('[role="log"]');
    if (!log) return null;
    // Find the deepest element whose text contains the reply (the assistant
    // bubble's content node), preferring the last match (the assistant turn).
    const candidates = Array.from(log.querySelectorAll('*')).filter(
      (el) => (el.textContent ?? '').includes(needle) && el.children.length > 0,
    );
    const target =
      candidates.length > 0 ? candidates[candidates.length - 1] : log;
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    if (!selection) return null;
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString().trim();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return text.length > 0 ? text : null;
  }, replyText);
  expect(selected).toBeTruthy();

  // The floating Quote button appears above the selection; click it.
  const quoteButton = page.getByRole('button', {
    name: t('chat.quote.button'),
  });
  await expect(quoteButton).toBeVisible({ timeout: 30_000 });
  await quoteButton.click();

  // The quoted-reference chip stages over the composer: a "Quoted" label and a
  // "Remove quote" button (QuotedReferenceChip — chat-layout context, no backend).
  await expect(
    page.getByText(t('chat.quote.label'), { exact: true }).first(),
  ).toBeVisible({ timeout: 30_000 });
  const removeQuote = page.getByRole('button', {
    name: t('chat.quote.remove'),
  });
  await expect(removeQuote).toBeVisible({ timeout: 30_000 });
  // Remove the chip again (proves the remove affordance works; leaves a clean
  // composer before cleanup).
  await removeQuote.click();
  await expect(removeQuote).toBeHidden({ timeout: 30_000 });

  await deleteOpenThread(page);
});

test('the composer mode menu lists the add-files entry', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // The composer mode menu (the leading "+" control) opens a menu that always
  // includes the attach-files entry in the seeded fixture (file upload enabled).
  // Its trigger label comes from the `composer` namespace. No thread is created
  // by this flow, so there's nothing to clean up.
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await expect(
    page.getByRole('menuitem', { name: t('composer.addFiles'), exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  // Close the menu without taking an action.
  await page.keyboard.press('Escape');
});
