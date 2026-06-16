import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import { CANNED_REPLY } from '../mock-llm/canned';

/**
 * Chat DEPTH flows against the seeded E2E agent — the hermetic subset of the
 * composer/header surface that `chat.spec.ts` (send/stream) and
 * `chat-threads.spec.ts` (threads/history/prompt-library) don't cover:
 *
 *  1. ATTACHMENTS — attach a small TEXT file to the composer via the hidden
 *     file input (`setInputFiles`), assert the attachment chip renders, then
 *     send and assert the user bubble shows the attachment by filename.
 *  2. AGENT PICKER — open the agent SearchableSelect and assert the single
 *     seeded "E2E Assistant" is listed/selectable; assert the model selector
 *     surfaces the single seeded model name.
 *  3. SHARING — create a share link for a freshly created thread (header Share
 *     action → enable-sharing switch), open the `/chat/shared/<token>` route
 *     and assert it renders the shared (read-only) view, then revoke the share
 *     and delete the thread.
 *
 * Mirrors `chat.spec.ts`: the composer-fill draft-key-flip `toPass` retry is
 * reused, and any LLM-CONTENT assertion is gated behind `isMockLlmMode()`.
 *
 * --- HERMETICITY NOTES (rule 7) ---
 *  - The TEXT attachment is hermetic: `convex/lib/attachments/process_attachments.ts`
 *    excludes text files from `documentAttachments`, so a `.txt` is never sent
 *    to the vision model nor parsed — it's only LISTED for the agent, and the
 *    mock LLM streams the canned reply without invoking any tool. The composer
 *    chip and the sent-message `FileAttachmentDisplay` are pure UI (no
 *    embeddings/vision), so both assertions hold in mock mode.
 *  - IMAGE / PDF attachments are deliberately NOT exercised: images go through
 *    `analyzeImageCached` (vision) and documents through `parseFile` + RAG —
 *    neither is served by the chat-SSE-only mock. Skipped per rule 7.
 *  - CONVERSATION STARTERS are NOT exercised: `WelcomeView` only renders starter
 *    chips when the agent declares `conversationStarters`, and the seeded
 *    `fixtures/config/default/agents/chat-agent.json` declares none (the empty
 *    state `welcomeEmpty` shows instead). There is nothing deterministic to
 *    click, so this sub-flow is skipped — see the `test.skip` below.
 *  - The share/revoke flow is hermetic: `shareThread`/`unshareThread` are plain
 *    Convex mutations (`app/features/chat/hooks/mutations.ts`), no LLM involved.
 */

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

// The seeded agent's DISPLAY NAME, from
// `fixtures/config/default/agents/chat-agent.json`. Fixture content (not
// translated UI copy), so it stays a single literal — mirrors
// `agents.spec.ts`'s `SEEDED_AGENT_DISPLAY_NAME`.
const SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant';

// The seeded model's DISPLAY NAME, from
// `fixtures/config/default/providers/e2e-mock.json`. Same rationale.
const SEEDED_MODEL_DISPLAY_NAME = 'E2E Chat Model';

/** Resolve the always-present composer textarea by its aria label. */
function composer(page: Page) {
  return page.getByRole('textbox', { name: t('chat.aria.chatInput') });
}

/**
 * Fill the composer reliably despite the draft-key flip (the controlled
 * textarea re-seeds from storage once the resolved-user-id key settles, so a
 * single type can ship a truncated value). Reused verbatim from `chat.spec.ts`.
 */
async function fillComposer(page: Page, message: string) {
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

/** Send the composed message (the round-trip's Send button). */
function sendButton(page: Page) {
  return page.getByRole('button', { name: t('chat.send'), exact: true });
}

test('attaches a text file to the composer and the sent message shows it', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // Unique per run so the filename and message never collide on the shared
  // backend (rule 4). A `.txt` is hermetic — see the file header.
  const suffix = Date.now().toString(36);
  const fileName = `e2e-attachment-${suffix}.txt`;
  const message = `E2E attachment probe ${suffix}`;

  // The hidden `<input type="file">` lives inside the composer's drop zone
  // (chat-input.tsx). setInputFiles drives it directly with an in-memory
  // buffer — no on-disk fixture needed — which routes through `uploadFiles`.
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Hello from the Tale E2E suite. This is a plain-text attachment.',
    ),
  });

  // The attachment chip renders once the upload round-trip lands. The
  // non-image chip carries a "Remove attachment" button (the filename is
  // middle-ellipsised, so target the stable control rather than the text).
  await expect(
    page.getByRole('button', { name: t('chat.removeAttachment') }).first(),
  ).toBeVisible({ timeout: 60_000 });
  // The filename surfaces on the chip via a `title` attribute (middleEllipsis
  // truncates the visible text but preserves the full name in `title`).
  await expect(page.locator(`[title="${fileName}"]`).first()).toBeVisible({
    timeout: 60_000,
  });

  // Type a message (the send-gate allows send with an attachment alone, but a
  // text message makes the user bubble unambiguous) and send.
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  // Optimistic user bubble appears with the text...
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: 30_000,
  });
  // ...and the sent message renders the attachment (FileAttachmentDisplay
  // keeps the filename in a `title`). Scope to the message log so we don't
  // match a lingering composer chip.
  const messageLog = page.getByRole('log', {
    name: t('chat.aria.messageHistory'),
  });
  await expect(messageLog.locator(`[title="${fileName}"]`).first()).toBeVisible(
    { timeout: 60_000 },
  );

  if (isMockLlmMode()) {
    // The text attachment is hermetic, so the canned reply still streams.
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  } else {
    await expect(sendButton(page)).toBeVisible({ timeout: 120_000 });
  }

  // Clean up the thread this test created (rule 4). The send created a thread
  // (URL gained an id); deleting the open thread routes back to /chat.
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();
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
});

test('agent picker lists the seeded agent and the model selector shows the seeded model', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // The agent SearchableSelect trigger carries `aria-label` = the picker
  // label (AgentSelector). It's disabled while the agent resolves, so wait
  // for it to enable before opening. The seeded org has one agent, so the
  // picker offers exactly that agent (no "Auto" — see AgentSelector: Auto is
  // only added when there's >1 agent).
  const agentTrigger = page
    .getByRole('button', { name: t('chat.agentSelector.label') })
    .first();
  await expect(agentTrigger).toBeEnabled({ timeout: 60_000 });
  await agentTrigger.click();

  // The seeded agent is listed as a selectable option in the open popover.
  const agentOption = page
    .getByRole('option', { name: SEEDED_AGENT_DISPLAY_NAME })
    .first();
  await expect(agentOption).toBeVisible({ timeout: 60_000 });
  await agentOption.click();

  // The trigger reflects the (only) seeded agent once selected/resolved.
  await expect(agentTrigger).toContainText(SEEDED_AGENT_DISPLAY_NAME, {
    timeout: 60_000,
  });

  // Model selector: the fixture ships two chat models, so the selector is a
  // picker (trigger labelled "Select model", default "Auto", options = Auto +
  // each model). Open it and assert the seeded model is offered. (`.first()`
  // because "E2E Chat Model" is a substring of "E2E Chat Model B".)
  const modelTrigger = page
    .getByRole('button', { name: t('chat.modelSelector.label') })
    .first();
  await expect(modelTrigger).toBeVisible({ timeout: 60_000 });
  await modelTrigger.click();
  await expect(
    page.getByRole('option', { name: SEEDED_MODEL_DISPLAY_NAME }).first(),
  ).toBeVisible({ timeout: 60_000 });
  // Close the picker without changing the selection.
  await page.keyboard.press('Escape');
});

test('creates a share link, opens the shared read-only view, then revokes it', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // Create our own thread to share (rule 4) — unique content so the shared
  // view's assertion is unambiguous.
  const suffix = Date.now().toString(36);
  const message = `E2E share probe ${suffix}`;
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  await expect(page.getByText(message).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  const threadId = THREAD_URL.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  // Wait for the turn to actually PERSIST before sharing. The bubble asserted
  // above is the OPTIMISTIC local message (pendingMessage) — the real message
  // is saved far downstream in the async generation pipeline
  // (chatWithAgentTurn schedules runChatTurnGeneration → startChat →
  // saveMessage). `getSharedThread` snapshots messages to
  // `_creationTime <= sharedAt` (set the instant sharing is enabled), so
  // enabling sharing before the message is saved permanently excludes it from
  // the immutable snapshot → an empty shared view (a reload can't recover it).
  // Gate on turn completion (mirrors the attachment test): the canned reply in
  // mock mode, or the Send button reappearing once generation ends otherwise —
  // by which point both the user and assistant messages are persisted.
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  } else {
    await expect(sendButton(page)).toBeVisible({ timeout: 120_000 });
  }

  // The header Share action (only rendered once a thread exists) opens the
  // share dialog.
  await page
    .getByRole('button', { name: t('chat.share.button') })
    .first()
    .click();
  const shareDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.share.title'), { exact: true }),
  });
  await expect(shareDialog).toBeVisible({ timeout: 60_000 });

  // Enable sharing. The Switch's accessible name is its label (Switch wires
  // the Radix control to a <Label htmlFor>). Toggling it fires the
  // `shareThread` mutation (pure Convex, hermetic).
  const shareSwitch = shareDialog.getByRole('switch', {
    name: t('chat.share.enableSharing'),
  });
  await expect(shareSwitch).toBeEnabled({ timeout: 30_000 });
  await shareSwitch.click();
  await expect(shareSwitch).toBeChecked({ timeout: 30_000 });

  // Once shared, the dialog reveals the link block + a "Preview" affordance
  // that navigates to the public shared route. Use it rather than scraping the
  // (CSS-truncated) URL text — the navigation target is deterministic.
  await expect(
    shareDialog.getByText(t('chat.share.linkLabel'), { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await shareDialog
    .getByRole('button', { name: t('chat.share.preview') })
    .click();

  // The shared route renders the read-only SharedChatView: it carries the
  // "Shared chat" sub-label and a "Fork this chat" button (the read-only
  // surface's signature — the live thread has neither), and replays the
  // original user message.
  await page.waitForURL(/\/chat\/shared\/[^/?#]+/, { timeout: 60_000 });
  await expect(
    page.getByText(t('chat.share.sharedChat'), { exact: true }).first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole('button', { name: t('chat.share.forkChat') }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: 60_000,
  });

  // Revoke the share (rule 4 cleanup): back to the thread, re-open the dialog,
  // toggle sharing off.
  await page.goto(`/dashboard/${organizationId}/chat/${threadId}`);
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole('button', { name: t('chat.share.button') })
    .first()
    .click();
  const reShareDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.share.title'), { exact: true }),
  });
  await expect(reShareDialog).toBeVisible({ timeout: 60_000 });
  const reShareSwitch = reShareDialog.getByRole('switch', {
    name: t('chat.share.enableSharing'),
  });
  // Re-opening reflects the persisted shared state (checked); turn it off.
  await expect(reShareSwitch).toBeChecked({ timeout: 30_000 });
  await reShareSwitch.click();
  await expect(reShareSwitch).not.toBeChecked({ timeout: 30_000 });
  // Closing the dialog (Escape) returns focus to the thread.
  await page.keyboard.press('Escape');

  // Delete the thread this test created.
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();
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
});

// CONVERSATION STARTERS: not hermetically exercisable with the seeded fixture.
// `WelcomeView` only renders starter chips when the active agent declares
// `conversationStarters`, and `fixtures/config/default/agents/chat-agent.json`
// declares none — the empty state (`welcomeEmpty`) shows instead, with no
// deterministic chip to click. Skipped rather than asserting against
// non-existent UI (rule 7: skip non-hermetic sub-flows with a clear note).
test.skip('conversation starter chips populate the composer', () => {
  // Intentionally empty — see the comment above. To enable this, the seeded
  // agent fixture would need a `conversationStarters` array; the flow would
  // then click the first chip (WelcomeView#onSuggestionClick → setInputValue)
  // and assert the composer value matches the chip text.
});
