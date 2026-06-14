import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import { CANNED_NEXT_STEPS_ITEMS, MOCK_TRIGGERS } from '../mock-llm/canned';

/**
 * Structured-output (NEXT_STEPS) chat flow against the seeded E2E agent.
 *
 * A user message containing `MOCK_TRIGGERS.nextSteps` makes the mock LLM
 * (`e2e/mock-llm/server.ts`) stream `CANNED_NEXT_STEPS_TEXT`: an intro line, a
 * `[[NEXT_STEPS]]` marker on its own line, then each `CANNED_NEXT_STEPS_ITEMS`
 * entry on its own line. The frontend marker parser
 * (`lib/utils/marker-parser.ts`) splits on that marker and `NextStepsSection`
 * (`app/features/chat/components/structured-message/section-renderers.tsx`)
 * renders each item as a `<Button>` (role=button, the item text as its
 * accessible name) inside a `<section aria-label={t('chat.structured.nextSteps')}>`.
 *
 * The flow:
 *   1. Send the trigger message (composer-fill draft-key-flip retry reused from
 *      `chat.spec.ts`); assert one follow-up BUTTON per canned item renders, and
 *      that the `[[NEXT_STEPS]]` marker is NOT shown verbatim (it's parsed away).
 *   2. Click the first follow-up button. Its onClick is `handleSendFollowUp`,
 *      which calls `setInputValue(item)` (chat-interface.tsx) — it POPULATES the
 *      composer, it does NOT auto-send. So we assert the composer now holds the
 *      item text, then click Send to submit it; the item then appears as a NEW
 *      user bubble (a `<p>`, distinct from the still-present button).
 *   3. Delete the thread we created (the only state this spec mutates).
 *
 * Whole-file guard: the NEXT_STEPS stream is deterministic ONLY under the mock,
 * so the spec is skipped against a live stack (E2E_MOCK_LLM=0).
 */

// Deterministic only under the mock — the canned NEXT_STEPS stream doesn't
// exist against a live provider.
test.beforeEach(() => {
  test.skip(!isMockLlmMode(), 'requires the deterministic mock LLM');
});

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

// Unique per run so the created thread never collides on the shared backend.
// The trigger substring drives the mock; the suffix keeps the user bubble
// unambiguous. (The thread title is backend-generated, so selectors never use it.)
const UNIQUE = Date.now().toString(36);
const TRIGGER_MESSAGE = `${MOCK_TRIGGERS.nextSteps} draft a plan ${UNIQUE}`;

/** The always-present composer textarea, resolved by its aria label. */
function composer(page: Page): Locator {
  return page.getByRole('textbox', { name: t('chat.aria.chatInput') });
}

/** The composed-message send button (the Send⇄Stop toggle in its Send state). */
function sendButton(page: Page): Locator {
  return page.getByRole('button', { name: t('chat.send'), exact: true });
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
 * Delete the currently-open thread via the history sidebar (rule 4 cleanup —
 * the only state this spec mutates, and it cleans up after itself). Mirrors the
 * delete flow in `chat-threads.spec.ts` / `chat-advanced.spec.ts`.
 */
async function deleteOpenThread(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();
  // Scope to the list <section> holding the "Chats" header so we don't grab the
  // chat-header's own "More actions" (Export) menu. Our freshly created thread
  // is the newest un-projected (unpinned) chat → the first row.
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

test('renders NEXT_STEPS follow-up buttons and a click sends the item as a new turn', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // --- 1. Send the trigger message; it creates a thread. ---
  await fillComposer(page, TRIGGER_MESSAGE);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  // Optimistic user bubble appears immediately, and the send creates a thread.
  await expect(page.getByText(TRIGGER_MESSAGE).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  expect(THREAD_URL.exec(page.url())?.[1]).toBeTruthy();

  // The structured section is labelled by the `chat.structured.nextSteps`
  // header key; wait for it so the assertions below race the full stream.
  const nextStepsSection = page.getByRole('region', {
    name: t('chat.structured.nextSteps'),
  });
  await expect(nextStepsSection).toBeVisible({ timeout: 120_000 });

  // Each canned item renders as its own clickable follow-up BUTTON whose
  // accessible name is the item text. Assert one button per item (no re-hardcode
  // of the strings — they come from the shared `CANNED_NEXT_STEPS_ITEMS`).
  for (const item of CANNED_NEXT_STEPS_ITEMS) {
    await expect(
      nextStepsSection.getByRole('button', { name: item, exact: true }),
    ).toBeVisible({ timeout: 120_000 });
  }

  // The `[[NEXT_STEPS]]` marker is structural — the parser strips it, so it must
  // never leak into the rendered turn as literal text.
  await expect(page.getByText('[[NEXT_STEPS]]')).toHaveCount(0);

  // --- 2. Click the first follow-up button → it POPULATES the composer
  // (handleSendFollowUp → setInputValue), it does not auto-send. ---
  const firstItem = CANNED_NEXT_STEPS_ITEMS[0];
  const firstFollowUp = nextStepsSection.getByRole('button', {
    name: firstItem,
    exact: true,
  });

  // Retry the click→value assertion: a follow-up click only sets the controlled
  // input value, and the draft-key has long since settled by now (the reply has
  // streamed), so a click reliably sticks — but re-clicking is idempotent.
  await expect(async () => {
    await firstFollowUp.click();
    await expect(composer(page)).toHaveValue(firstItem);
  }).toPass({ timeout: 30_000 });

  // Submit it as a NEW user turn. The item text contains no trigger substring,
  // so this second turn gets the plain canned reply (no extra NEXT_STEPS buttons).
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  // The item text now appears as a USER BUBBLE — a `<p>`, distinct from the
  // still-present follow-up `<button>` of the same text. `.and(locator('p'))`
  // requires BOTH locators to match the same element, so it matches only the
  // paragraph bubble, never the button. Scope to the message log for clarity.
  await expect(
    messageLog(page)
      .getByText(firstItem, { exact: true })
      .and(page.locator('p')),
  ).toBeVisible({ timeout: 60_000 });

  // --- 3. Clean up the thread this test created. ---
  await deleteOpenThread(page);
});
