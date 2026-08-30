import { expect, type Locator, type Page } from '@playwright/test';

import { CANNED_REPLY } from '../../../lib/mocks/overrides/canned';
import { ENTITY_ID, isMockLlmMode, TIMEOUT } from './env';
import { t } from './i18n';

/**
 * Shared chat interaction primitives. The nine chat specs each re-implemented
 * composer-fill, new-thread send, reply-wait and thread cleanup verbatim; this
 * is the single source. Two of those copies were also the suite's worst
 * flakiness: the draft-key-flip retry (now one implementation, not nine) and
 * positional `.first()` thread deletion (now deterministic by thread id — a
 * prerequisite for `fullyParallel`, where several threads coexist in a worker's
 * org).
 */

const THREAD_URL = new RegExp(`/chat/(${ENTITY_ID})(?:[/?#]|$)`);

/** The always-present composer textarea (resolved by its aria label). */
export function composer(page: Page): Locator {
  return page.getByRole('textbox', { name: t('chat.aria.chatInput') });
}

/** The composed-message send button (the Send⇄Stop toggle in its Send state). */
export function sendButton(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.send'), exact: true });
}

/** The same toggle in its Stop state (visible only while a turn is in flight). */
export function stopButton(page: Page): Locator {
  return page.getByRole('button', {
    name: t('chat.stopGenerating'),
    exact: true,
  });
}

/** The role=log region wrapping the rendered message bubbles. */
export function messageLog(page: Page): Locator {
  return page.getByRole('log', { name: t('chat.aria.messageHistory') });
}

/** Assistant message bubbles only. */
export function assistantMessages(page: Page): Locator {
  return page.locator(
    '[data-testid="chat-message"][data-message-role="assistant"]',
  );
}

/**
 * Fill the composer reliably despite the draft-key flip: the controlled
 * textarea re-seeds from storage once the resolved-user-id key settles, so a
 * single type can ship a truncated value. Retry clear+type until it sticks (the
 * key flips at most once, so a later attempt always wins). ONE implementation
 * for the whole suite.
 */
export async function fillComposer(page: Page, message: string): Promise<void> {
  const box = composer(page);
  await expect(box).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(box).toBeEnabled();
  await box.click();
  await expect(async () => {
    await box.fill('');
    await box.pressSequentially(message);
    await expect(box).toHaveValue(message);
  }).toPass({ timeout: TIMEOUT.VISIBLE });
}

/**
 * Send `message` into a fresh chat surface, confirm the optimistic user bubble,
 * and wait for the round-trip to create a thread. Returns the new thread id (so
 * callers can clean up deterministically via `deleteThreadById`).
 */
export async function sendNewThreadMessage(
  page: Page,
  message: string,
): Promise<string> {
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await page.waitForURL(THREAD_URL, { timeout: TIMEOUT.NAV });
  const threadId = THREAD_URL.exec(page.url())?.[1];
  if (!threadId) {
    throw new Error(`No thread id in the URL after sending: ${page.url()}`);
  }
  return threadId;
}

/**
 * Send a follow-up turn into the already-open thread (no navigation). Asserts
 * the optimistic user bubble; the reply is the caller's concern.
 */
export async function sendFollowUp(page: Page, message: string): Promise<void> {
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
}

/**
 * Wait for the in-flight turn to finish: the Stop affordance reverts to Send.
 * Polls the authoritative `isGenerating` toggle (not a text race) by asserting
 * the Stop button is gone and the Send button is back. NOTE: a completed turn
 * leaves the composer empty, so Send is *disabled* (it only enables once the
 * user types) — asserting `toBeEnabled()` here would hang the whole timeout on
 * every default-path turn. The label flip (Stop→Send) is the real signal.
 */
export async function waitForReplyComplete(page: Page): Promise<void> {
  await expect(stopButton(page)).toBeHidden({ timeout: TIMEOUT.REPLY });
  await expect(sendButton(page)).toBeVisible({ timeout: TIMEOUT.REPLY });
}

/** Assert the canned mock reply rendered (mock mode only — no-op live). */
export async function expectCannedReply(page: Page): Promise<void> {
  if (!isMockLlmMode()) return;
  await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
    timeout: TIMEOUT.REPLY,
  });
}

/**
 * Delete a thread deterministically by its id via the chat sub-panel's
 * history list (always visible on chat routes at desktop width — no sidebar
 * toggle involved). Scopes to the row carrying `data-thread-id` (added to
 * `ChatRow`) — never `.first()`, so a sibling test's thread can never be
 * deleted by mistake under parallelism.
 */
export async function deleteThreadById(
  page: Page,
  threadId: string,
): Promise<void> {
  const row = page.locator(`[data-thread-id="${threadId}"]`);
  await expect(row).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  const rowActions = row.getByRole('button', { name: t('chat.moreActions') });
  await rowActions.scrollIntoViewIfNeeded();
  await rowActions.click();

  await page
    .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
    .click();
  await page
    .getByRole('button', { name: t('chat.deleteChat'), exact: true })
    .click();

  // The row's removal is the deterministic "deleted" signal (regardless of
  // whether the deleted thread was the open one).
  await expect(row).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
}
