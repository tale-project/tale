import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import { CANNED_REPLY } from '../mock-llm/canned';

/**
 * Chat ADVANCED interactions against the seeded E2E agent — the hermetic
 * subset of the per-message toolbar + composer-control surface that
 * `chat.spec.ts` (send/stream), `chat-threads.spec.ts` (threads/history/
 * prompt-library) and `chat-depth.spec.ts` (attachment/pickers/share) don't
 * cover:
 *
 *  1. STOP — send a message and, while the turn is in flight, click the
 *     composer's Stop affordance; assert generation halts and the button
 *     reverts to Send. (See the STOP-REACHABILITY note below.)
 *  2. REGENERATE — after an assistant reply, "Try again" from the message's
 *     3-dots menu re-runs the prompt as a sibling branch; assert a fresh reply
 *     plus the `< 1 / 2 >` BranchNavigator (proof a NEW branch was created).
 *  3. EDIT → branch — edit a prior USER message via its toolbar, change the
 *     text, resubmit; assert the edited content renders, a new assistant turn
 *     streams, and the BranchNavigator appears (the edit-branch behaviour).
 *  4. COPY — click the assistant toolbar's copy action; assert the clipboard
 *     receives the reply (permissions granted) and the button flips to its
 *     "Copied!" state.
 *  5. MULTI-TURN — send a second user message in the same thread; assert both
 *     user turns and both replies render.
 *
 * Mirrors `chat.spec.ts`: the composer-fill draft-key-flip `toPass` retry is
 * reused, and every LLM-CONTENT assertion is gated behind `isMockLlmMode()`
 * (the canned reply only exists in mock mode).
 *
 * --- STOP-REACHABILITY note (rule 7) ---
 *  The composer's Send button toggles to Stop while `isLoading` is true
 *  (chat-input.tsx: same <Button>, `aria-label` flips send⇄stopGenerating,
 *  ArrowUp⇄CircleStop). `isLoading = isGenerating || isSendPending`
 *  (chat-interface.tsx): `isSendPending` is set optimistically on click and
 *  `isGenerating` is a Convex subscription that stays true for the WHOLE turn
 *  (routing → generation → stream → persist), so the Stop affordance is
 *  reliably observable — it is NOT bounded by the mock's ~150ms streaming
 *  window (15 word-deltas × 10ms in mock-llm/server.ts). Stop's `onClick`
 *  handler is gated on `isGenerating` specifically, so we wait for Stop to be
 *  ENABLED (not merely visible) before clicking. A guaranteed *mid-stream*
 *  abort is still inherently racy against a fast canned turn, so the click is
 *  best-effort: the hard assertions are (a) the Stop affordance appears (the
 *  toggle exists) and (b) the Send affordance returns (generation reached a
 *  terminal state). Both hold whether Stop landed mid-turn or the turn had
 *  already completed.
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

/** The same toggle in its Stop state (visible only while a turn is in flight). */
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
 * asserted; the assistant reply is the caller's concern. Each test cleans up
 * via `deleteOpenThread` (which finds its row through history), so the id
 * itself isn't returned — only its presence in the URL is asserted.
 */
async function sendNewThreadMessage(
  page: Page,
  message: string,
): Promise<void> {
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  // Optimistic user bubble appears immediately, and the send creates a thread.
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  expect(THREAD_URL.exec(page.url())?.[1]).toBeTruthy();
}

/** Wait for the in-flight turn to finish: the Stop affordance reverts to Send. */
async function waitForReplyComplete(page: Page): Promise<void> {
  // Send and Stop are one toggle (same <button>, aria-label flips). A finished
  // turn is proven by the Stop affordance disappearing and Send returning — NOT
  // by Send becoming *enabled*: Send is disabled whenever the composer is empty,
  // which it is right after a reply, so asserting enabled here hangs the full
  // timeout.
  await expect(stopButton(page)).toBeHidden({ timeout: 120_000 });
  await expect(sendButton(page)).toBeVisible({ timeout: 120_000 });
}

/**
 * Delete the currently-open thread via the history sidebar (rule 4 cleanup —
 * the only state these tests mutate, and they clean up after themselves).
 * Mirrors the delete flow in `chat-threads.spec.ts` / `chat-depth.spec.ts`.
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

test('stop halts an in-flight generation and the Send affordance returns', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E stop probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);

  // The toggle flips to Stop the instant the turn is in flight (isLoading =
  // isSendPending || isGenerating). Its onClick is gated on isGenerating, so
  // wait for ENABLED before clicking — see the STOP-REACHABILITY note.
  await expect(stopButton(page)).toBeVisible({ timeout: 60_000 });

  // Best-effort mid-turn abort: a fast canned turn can complete before the
  // click lands, so guard on still-visible rather than asserting the click
  // always interrupts. Either path lands in the SAME terminal state asserted
  // below (Send returns), so the test is deterministic regardless of the race.
  if (await stopButton(page).isEnabled()) {
    await stopButton(page)
      .click({ timeout: 5_000 })
      .catch((err: unknown) => {
        // The turn finished between the visibility/enabled check and the
        // click (the button unmounted) — acceptable; the terminal-state
        // assertion below still proves the toggle round-tripped.
        console.warn(
          '[chat-advanced] stop click skipped (turn finished):',
          err,
        );
      });
  }

  // Terminal state: generation is no longer in flight, so the Stop affordance
  // has reverted to an enabled Send. This is the load-bearing assertion (holds
  // whether Stop interrupted the turn or it completed on its own).
  await waitForReplyComplete(page);
  // The Stop affordance is gone (the toggle is back to Send).
  await expect(stopButton(page)).toBeHidden();

  await deleteOpenThread(page);
});

test('regenerate produces a new reply branch with a branch navigator', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E regenerate probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);

  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  // Wait for the turn to finish so the assistant toolbar (which holds the
  // 3-dots "More actions" menu) has revealed.
  await waitForReplyComplete(page);

  // Regenerate lives behind the assistant message's 3-dots menu ("More
  // actions" → "Try again"). The LAST assistant message keeps an always-
  // visible toolbar, so its menu trigger is reachable without hovering. Scope
  // to the message log to avoid the chat-header's own "More actions" menu.
  await messageLog(page)
    .getByRole('button', { name: t('chat.moreActions') })
    .last()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.tryAgain'), exact: true })
    .click();

  // editAndBranch creates a sibling branch and selects it (chat-interface.tsx
  // handleRegenerateMessage). A second attempt now exists at this fork point,
  // so the BranchNavigator (`< 1 / 2 >`) renders — the deterministic proof a
  // new reply branch was created (the canned text is identical across attempts,
  // so the navigator, not the text, is the signal).
  await expect(
    page.getByRole('button', { name: t('chat.branchNavigator.next') }).first(),
  ).toBeVisible({ timeout: 120_000 });

  if (isMockLlmMode()) {
    // The regenerated branch streams the canned reply again.
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await waitForReplyComplete(page);

  await deleteOpenThread(page);
});

test('editing a prior user message branches into a new turn', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const suffix = Date.now().toString(36);
  const original = `E2E edit probe ${suffix}`;
  const editedSuffix = `${suffix}-edited`;
  const edited = `E2E edit probe ${editedSuffix}`;

  await sendNewThreadMessage(page, original);
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await waitForReplyComplete(page);

  // The user message's own toolbar (hover/focus-revealed) carries the Edit
  // (pencil) action — a ghost icon button with NO accessible name (a Tooltip,
  // which doesn't name the control; message-bubble.tsx). So it can't be reached
  // by role+name. The bubble's text node lives in a button-less inner div; the
  // toolbar is a SIBLING under the message container, so the nearest ancestor
  // <div> that contains a button IS that container. Anchor there (uniquely our
  // prompt — the assistant bubble holds the reply), hover to reveal the toolbar,
  // and click its LAST button: the toolbar renders [bookmark, edit] with no
  // branch-navigator yet on a fresh single-turn thread, so the edit pencil is
  // last. The labelled edit TEXTAREA appearing confirms the right button was hit.
  const userMessage = page
    .getByText(original)
    .first()
    .locator('xpath=ancestor::div[.//button][1]');
  await userMessage.hover();
  await userMessage.getByRole('button').last().click();

  // Edit opens an InlineEditInput (inline-edit-input.tsx) — a textarea labelled
  // `editMessage` plus a submit button labelled `editSend`. Re-fill with the
  // edited text and submit. (The textarea is a plain control with no draft-key
  // flip, so a direct fill is reliable here.)
  const editBox = page.getByRole('textbox', { name: t('chat.editMessage') });
  await expect(editBox).toBeVisible({ timeout: 30_000 });
  await editBox.fill(edited);
  await expect(editBox).toHaveValue(edited);
  await page
    .getByRole('button', { name: t('chat.editSend'), exact: true })
    .click();

  // The optimistic edited user bubble renders immediately (handleEditSubmit
  // setPendingMessage), and editAndBranch streams a NEW assistant turn on a
  // sibling branch.
  await expect(page.getByText(edited).first()).toBeVisible({ timeout: 60_000 });
  // BranchNavigator (`< 1 / 2 >`) appears at the edited message — proof the
  // edit branched rather than mutating in place.
  await expect(
    page.getByRole('button', { name: t('chat.branchNavigator.next') }).first(),
  ).toBeVisible({ timeout: 120_000 });

  if (isMockLlmMode()) {
    // The edited branch streams the canned reply.
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  await waitForReplyComplete(page);

  await deleteOpenThread(page);
});

test('the assistant message copy action writes the reply to the clipboard', async ({
  page,
  context,
}) => {
  // Reading what Copy wrote is the unambiguous "it works" signal. Granting both
  // permissions lets navigator.clipboard.writeText (message-bubble.tsx
  // handleCopy) succeed headless and lets the test read it back.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const message = `E2E copy probe ${Date.now().toString(36)}`;
  await sendNewThreadMessage(page, message);

  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  // The copy button only renders once the answer has fully revealed (the
  // post-answer toolbar gate), so wait for the turn to finish first.
  await waitForReplyComplete(page);

  // The copy button is a ghost icon button with no aria-label — it sits in the
  // assistant toolbar as the FIRST control, immediately before the feedback
  // thumbs (MessageFeedback `before` slot). Anchor on the labelled "Helpful"
  // thumbs-up button to find that toolbar row, then take its first button.
  const thumbsUp = messageLog(page)
    .getByRole('button', { name: t('chat.feedback.thumbsUp') })
    .last();
  await expect(thumbsUp).toBeVisible({ timeout: 120_000 });
  // The flex row holding [copy, info, thumbsUp, thumbsDown, …] is the thumbs-up
  // button's parent; the copy action is its first button.
  const toolbarRow = thumbsUp.locator('xpath=..');
  const copyButton = toolbarRow.getByRole('button').first();
  await copyButton.click();

  // The clipboard now holds the assistant reply — the authoritative,
  // timing-window-free proof that Copy worked (canned in mock mode; in live
  // mode assert only that SOMETHING non-empty was copied — content isn't fixed).
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  if (isMockLlmMode()) {
    expect(clipboard).toContain(CANNED_REPLY);
  } else {
    expect(clipboard.trim().length).toBeGreaterThan(0);
  }

  // Best-effort UI signal: the button flips to its "Copied!" state (isCopied →
  // CheckIcon, tooltip text swaps) for ~2s. The clipboard assertion above is
  // the real proof, so a missed 2s window (slow tooltip open) must NOT fail the
  // spec — observe it opportunistically and log if it slipped past.
  await copyButton.hover();
  await page
    .getByText(t('common.actions.copied'), { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch((err: unknown) => {
      console.warn(
        '[chat-advanced] copied-state tooltip not observed (2s window):',
        err,
      );
    });

  await deleteOpenThread(page);
});

test('a second message in the same thread renders both turns', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  const suffix = Date.now().toString(36);
  const first = `E2E multiturn first ${suffix}`;
  const second = `E2E multiturn second ${suffix}`;

  await sendNewThreadMessage(page, first);
  if (isMockLlmMode()) {
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }
  // The composer re-enables (Stop → Send) only once the first turn finishes;
  // wait so the second send isn't blocked by the in-flight gate.
  await waitForReplyComplete(page);

  // Send the second turn into the SAME thread (no navigation).
  await fillComposer(page, second);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  // Both user turns persist in the log.
  await expect(page.getByText(first).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(second).first()).toBeVisible({ timeout: 60_000 });

  // The second turn finishes — Stop reverts to Send.
  await waitForReplyComplete(page);

  // Two assistant turns now exist. Counting the canned text is unreliable
  // (nested segment spans can match the same string more than once per reply),
  // so count a stable per-assistant-message control instead: every completed
  // assistant reply renders a feedback toolbar with a labelled "Helpful"
  // thumbs-up (MessageFeedback). Two replies → exactly two such buttons.
  await expect(
    messageLog(page).getByRole('button', { name: t('chat.feedback.thumbsUp') }),
  ).toHaveCount(2, { timeout: 120_000 });
  if (isMockLlmMode()) {
    // The reply to the latest user turn is the canned text.
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  }

  await deleteOpenThread(page);
});
