import {
  assistantMessages,
  composer,
  deleteThreadById,
  expectCannedReply,
  messageLog,
  sendFollowUp,
  sendNewThreadMessage,
  stopButton,
  waitForReplyComplete,
} from '../helpers/chat';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Advanced per-message + composer-control flows (stop, regenerate, edit-branch,
 * multi-turn) against the seeded agent. The Stop affordance is the
 * Send⇄Stop toggle while `isGenerating` is true (whole turn), so it's reliably
 * observable; a guaranteed mid-stream abort is racy against the fast canned
 * turn, so the load-bearing assertions are toggle-exists + Send-returns.
 */

test('stop halts an in-flight generation and the Send affordance returns', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const message = `E2E stop probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);

  // Stop's onClick is gated on isGenerating, so wait for ENABLED before
  // clicking. Best-effort: a fast canned turn can finish before the click
  // lands; either path reaches the same terminal state asserted below.
  await expect(stopButton(page)).toBeVisible({ timeout: TIMEOUT.REPLY });
  if (await stopButton(page).isEnabled()) {
    await stopButton(page)
      .click({ timeout: TIMEOUT.VISIBLE })
      .catch((err: unknown) => {
        console.warn(
          '[chat-advanced] stop click skipped (turn finished):',
          err,
        );
      });
  }

  await waitForReplyComplete(page);
  await expect(stopButton(page)).toBeHidden();

  await deleteThreadById(page, threadId);
});

test('regenerate produces a new reply branch with a branch navigator', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const message = `E2E regenerate probe ${Date.now().toString(36)}`;
  const threadId = await sendNewThreadMessage(page, message);
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  // "Try again" lives behind the last assistant message's always-visible 3-dots
  // menu. Scope to the message log to avoid the chat-header's own menu.
  await messageLog(page)
    .getByRole('button', { name: t('chat.moreActions') })
    .last()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.tryAgain'), exact: true })
    .click();

  // editAndBranch creates + selects a sibling branch, so the BranchNavigator
  // (`< 1 / 2 >`) renders — the deterministic proof a new branch was created
  // (the canned text is identical across attempts).
  await expect(
    page.getByRole('button', { name: t('chat.branchNavigator.next') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.REPLY });
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  await deleteThreadById(page, threadId);
});

test('editing a prior user message branches into a new turn', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const suffix = Date.now().toString(36);
  const original = `E2E edit probe ${suffix}`;
  const edited = `E2E edit probe ${suffix}-edited`;

  const threadId = await sendNewThreadMessage(page, original);
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  // The Edit (pencil) action sits in the user message's own toolbar as a ghost
  // icon button with no accessible name. Scope to the last user message
  // container (testid) and take its LAST button — the toolbar is [bookmark,
  // edit] on a fresh single-turn thread, so edit is last. The labelled edit
  // textarea appearing confirms the right button was hit.
  const userContainer = page
    .locator('[data-testid="chat-message"][data-message-role="user"]')
    .last();
  await userContainer.hover();
  await userContainer.getByRole('button').last().click();

  const editBox = page.getByRole('textbox', { name: t('chat.editMessage') });
  await expect(editBox).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await editBox.fill(edited);
  await expect(editBox).toHaveValue(edited);
  await page
    .getByRole('button', { name: t('chat.editSend'), exact: true })
    .click();

  // The optimistic edited bubble renders, and editAndBranch streams a NEW
  // assistant turn on a sibling branch.
  await expect(page.getByText(edited).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await expect(
    page.getByRole('button', { name: t('chat.branchNavigator.next') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.REPLY });
  await expectCannedReply(page);
  await waitForReplyComplete(page);

  await deleteThreadById(page, threadId);
});

// The assistant-message copy action moved to a component test:
// app/features/chat/components/message-bubble.test.tsx (renders the real
// MessageBubble and asserts the copy button calls navigator.clipboard.writeText
// with the reply — the clipboard write is the seam, faithfully mockable in jsdom).
test('a second message in the same thread renders both turns', async ({
  page,
  org,
}) => {
  await page.goto(`/dashboard/${org.organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const suffix = Date.now().toString(36);
  const first = `E2E multiturn first ${suffix}`;
  const second = `E2E multiturn second ${suffix}`;

  const threadId = await sendNewThreadMessage(page, first);
  await expectCannedReply(page);
  // The composer re-enables only once the first turn finishes.
  await waitForReplyComplete(page);

  await sendFollowUp(page, second);

  // Both user turns persist in the log.
  await expect(page.getByText(first).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await expect(page.getByText(second).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await waitForReplyComplete(page);

  // Two assistant turns now exist. Count the assistant message bubbles by their
  // stable `data-message-role` testid — counting the canned text re-matches
  // nested segment spans, and counting the "Helpful" thumbs-up double-counts
  // (each completed reply renders both its always-visible toolbar AND an
  // opacity-0 hover toolbar, so `getByRole` resolves two per message).
  await expect(assistantMessages(page)).toHaveCount(2, {
    timeout: TIMEOUT.REPLY,
  });
  await expectCannedReply(page);

  await deleteThreadById(page, threadId);
});
