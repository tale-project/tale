import {
  composer,
  deleteThreadById,
  expectCannedReply,
  fillComposer,
  messageLog,
  sendButton,
  sendNewThreadMessage,
  waitForReplyComplete,
} from '../helpers/chat';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { SEEDED_AGENT_DISPLAY_NAME } from '../helpers/seed';

/**
 * Chat depth flows: a hermetic TEXT attachment (excluded from vision/RAG, so
 * the mock streams the canned reply), the agent/model picker surfacing the
 * seeded fixtures, and the create→open→revoke share-link flow
 * (`shareThread`/`unshareThread` are plain Convex mutations, no LLM).
 */

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

// The seeded chat model's DISPLAY NAME, from
// `fixtures/config/default/providers/e2e-mock.json`. Fixture content (not
// translated UI copy), so it stays a single literal — mirrors
// `helpers/seed.ts`'s `SEEDED_AGENT_DISPLAY_NAME`. The fixture also ships an
// "E2E Chat Model B", so locators use `.first()` (this name is its prefix).
const SEEDED_MODEL_DISPLAY_NAME = 'E2E Chat Model';

test('attaches a text file to the composer and the sent message shows it', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const suffix = Date.now().toString(36);
  const fileName = `e2e-attachment-${suffix}.txt`;
  const message = `E2E attachment probe ${suffix}`;

  // The hidden `<input type="file">` lives inside the composer drop zone;
  // setInputFiles drives it with an in-memory buffer (no on-disk fixture).
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Hello from the Tale E2E suite. This is a plain-text attachment.',
    ),
  });

  // The chip renders once the upload lands. Its filename is middle-ellipsised,
  // so the full name lives in a `title` attribute; the chip also carries a
  // stable "Remove attachment" button.
  await expect(
    page.getByRole('button', { name: t('chat.removeAttachment') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(page.locator(`[title="${fileName}"]`).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // A text message makes the sent user bubble unambiguous, then send.
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  // The sent message renders the attachment (FileAttachmentDisplay keeps the
  // filename in `title`). Scope to the log so we don't match a composer chip.
  await expect(
    messageLog(page).locator(`[title="${fileName}"]`).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // The text attachment is hermetic, so the canned reply still streams.
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  // The send created a thread; clean it up by the captured id.
  await page.waitForURL(THREAD_URL, { timeout: TIMEOUT.NAV });
  const threadId = THREAD_URL.exec(page.url())?.[1];
  if (!threadId) throw new Error('expected a thread id in the URL after send');
  await deleteThreadById(page, threadId);
});

test('agent picker lists the seeded agent and the model selector shows the seeded model', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The agent SearchableSelect trigger carries `aria-label` = the picker label
  // (AgentSelector). It's disabled while the agent resolves, so wait for it to
  // enable before opening.
  const agentTrigger = page
    .getByRole('button', { name: t('chat.agentSelector.label') })
    .first();
  await expect(agentTrigger).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
  await agentTrigger.click();

  // The seeded agent is listed as a selectable option in the open popover.
  const agentOption = page
    .getByRole('option', { name: SEEDED_AGENT_DISPLAY_NAME })
    .first();
  await expect(agentOption).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await agentOption.click();

  // The trigger reflects the (only) seeded agent once selected/resolved.
  await expect(agentTrigger).toContainText(SEEDED_AGENT_DISPLAY_NAME, {
    timeout: TIMEOUT.VISIBLE,
  });

  // Model selector: the fixture ships multiple chat models, so the selector is
  // a picker (trigger labelled "Select model"). Open it and assert the seeded
  // model is offered. `.first()` because "E2E Chat Model" is a substring of
  // "E2E Chat Model B".
  const modelTrigger = page
    .getByRole('button', { name: t('chat.modelSelector.label') })
    .first();
  await expect(modelTrigger).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await modelTrigger.click();
  await expect(
    page.getByRole('option', { name: SEEDED_MODEL_DISPLAY_NAME }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Close the picker without changing the selection (no thread was created, so
  // there is nothing to clean up).
  await page.keyboard.press('Escape');
});

test('creates a share link, opens the shared read-only view, then revokes it', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Our own thread to share, unique content so the shared-view assertion is
  // unambiguous.
  const message = `E2E share probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  // sharedAt is a transcript snapshot boundary — wait for the turn (and the
  // user message's server persist) to finish before enabling share, or a slow
  // `runChatTurnGeneration` start can land the message with a _creationTime
  // after sharedAt and the preview omits it.
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  // The header Share action opens the share dialog.
  await page
    .getByRole('button', { name: t('chat.share.button') })
    .first()
    .click();
  const shareDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.share.title'), { exact: true }),
  });
  await expect(shareDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Enable sharing (fires the `shareThread` mutation — hermetic).
  const shareSwitch = shareDialog.getByRole('switch', {
    name: t('chat.share.enableSharing'),
  });
  await expect(shareSwitch).toBeEnabled({ timeout: TIMEOUT.PERSIST });
  await shareSwitch.click();
  await expect(shareSwitch).toBeChecked({ timeout: TIMEOUT.PERSIST });

  // Once shared, the dialog reveals the link block + a "Preview" affordance
  // that navigates to the public route (deterministic vs scraping the URL text).
  await expect(
    shareDialog.getByText(t('chat.share.linkLabel'), { exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await shareDialog
    .getByRole('button', { name: t('chat.share.preview') })
    .click();

  // The shared route renders the read-only SharedChatView: a "Shared chat"
  // sub-label + a "Fork this chat" button (the read-only signature), and
  // replays the original user message.
  await page.waitForURL(/\/chat\/shared\/[^/?#]+/, { timeout: TIMEOUT.NAV });
  await expect(
    page.getByText(t('chat.share.sharedChat'), { exact: true }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    page.getByRole('button', { name: t('chat.share.forkChat') }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // Revoke the share (cleanup): back to the thread, re-open the dialog, toggle
  // sharing off.
  await page.goto(`/dashboard/${organizationId}/chat/${threadId}`);
  await page.waitForURL(THREAD_URL, { timeout: TIMEOUT.NAV });
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await page
    .getByRole('button', { name: t('chat.share.button') })
    .first()
    .click();
  const reShareDialog = page.getByRole('dialog').filter({
    has: page.getByText(t('chat.share.title'), { exact: true }),
  });
  await expect(reShareDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  const reShareSwitch = reShareDialog.getByRole('switch', {
    name: t('chat.share.enableSharing'),
  });
  // Re-opening reflects the persisted shared state (checked); turn it off.
  await expect(reShareSwitch).toBeChecked({ timeout: TIMEOUT.PERSIST });
  await reShareSwitch.click();
  await expect(reShareSwitch).not.toBeChecked({ timeout: TIMEOUT.PERSIST });
  await page.keyboard.press('Escape');

  await deleteThreadById(page, threadId);
});
