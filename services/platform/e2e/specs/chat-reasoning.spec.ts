import { expect, test } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import {
  CANNED_REASONING,
  CANNED_REASONING_ANSWER,
  MOCK_TRIGGERS,
} from '../mock-llm/canned';

/**
 * Chat reasoning ("Thinking" disclosure) flow against the seeded E2E agent.
 *
 * A user message containing `MOCK_TRIGGERS.reasoning` makes the mock LLM stream
 * `CANNED_REASONING` first as `delta.reasoning_content` (→ an inline reasoning
 * block), then `CANNED_REASONING_ANSWER` as normal content. This is
 * deterministic ONLY under the mock, so the whole file is skipped on a live
 * stack.
 *
 * Product behavior (project memory + `message-thought-header.tsx` /
 * `thought-header.tsx`): the per-message thought header is the SINGLE reasoning
 * control. It is COLLAPSED by default and user-controlled — it never
 * auto-expands. So the test asserts the collapsed disclosure, CLICKS it, then
 * asserts the reasoning prose. The disclosure is a `<button>` (`aria-expanded`)
 * whose accessible name is the live "Thinking" label only WHILE streaming; once
 * the turn ends it latches the "·"-separated summary
 * (`chat.thoughtProcess.durationLabel` "Thought for {seconds}s" first, then tool/
 * token counts) — e.g. "Thought for 1s · 16 tokens". The test waits for the
 * final answer first (turn done), so it matches the settled summary by the
 * locale-derived "Thought for" prefix (`durationLabel` minus its placeholder
 * tail). The seconds/token values are non-deterministic, hence a prefix regex.
 * When the header is NOT expandable it renders as a plain `<div>`, not a button,
 * so the button role still disambiguates from any non-reasoning header.
 *
 * Idempotent: creates its own thread and deletes it (the delete flow mirrors
 * `chat-threads.spec.ts`).
 */

// Skip on a live stack — only the mock streams the reasoning scenario verbatim.
test.skip(!isMockLlmMode(), 'requires the deterministic mock LLM');

// Unique per run so the user bubble is unambiguous and threads never collide on
// the shared backend. Carries the reasoning trigger so the mock takes the
// reasoning branch.
const MESSAGE = `${MOCK_TRIGGERS.reasoning} E2E reasoning probe ${Date.now().toString(36)}`;

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

test('streams a reasoning block, expands it on click, then deletes the thread', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);

  const composer = page.getByRole('textbox', {
    name: t('chat.aria.chatInput'),
  });
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(composer).toBeEnabled();

  // Draft-key flip retry — see `chat.spec.ts` for the full rationale. The
  // controlled textarea re-seeds from storage once the user-id key settles, so
  // a single type-then-send can ship a truncated message; retry until it sticks.
  await composer.click();
  await expect(async () => {
    await composer.fill('');
    await composer.pressSequentially(MESSAGE);
    await expect(composer).toHaveValue(MESSAGE);
  }).toPass({ timeout: 30_000 });

  const sendButton = page.getByRole('button', {
    name: t('chat.send'),
    exact: true,
  });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // Optimistic user bubble appears immediately; the send creates a thread (the
  // URL gains a thread id). Capture it for the delete step.
  await expect(page.getByText(MESSAGE).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  const threadId = THREAD_URL.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  // The final answer (streamed after the reasoning block) renders.
  await expect(page.getByText(CANNED_REASONING_ANSWER).first()).toBeVisible({
    timeout: 120_000,
  });

  // The reasoning disclosure is the per-message thought header button. The turn
  // has finished (the answer above is visible), so its accessible name has
  // latched to the settled summary ("Thought for Ns · M tokens"), NOT the live
  // "Thinking" verb. Match the locale-derived "Thought for" prefix — the seconds
  // and token counts are non-deterministic. It is COLLAPSED by default
  // (`aria-expanded="false"`); the reasoning prose must NOT be visible until it
  // is clicked.
  //
  // `t('chat.thoughtProcess.durationLabel')` is the raw ICU string
  // "Thought for {seconds}s"; everything before the placeholder is the stable
  // prefix to anchor on.
  const durationPrefix = t('chat.thoughtProcess.durationLabel').split('{')[0];
  const reasoningToggle = page
    .getByRole('button', {
      name: new RegExp(`^${durationPrefix.replace(/\s+$/, '')}`),
    })
    .first();
  await expect(reasoningToggle).toBeVisible({ timeout: 60_000 });
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(CANNED_REASONING).first()).toBeHidden();

  // Expand it — user-controlled disclosure.
  await reasoningToggle.click();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'true');

  // The reasoning prose is now revealed (streaming is finished, so the
  // typewriter renders it in full immediately).
  await expect(page.getByText(CANNED_REASONING).first()).toBeVisible({
    timeout: 60_000,
  });

  // Clean up the thread this test created (delete flow mirrors
  // `chat-threads.spec.ts`). Open history, open our row's actions menu, delete,
  // and confirm.
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();

  // Scope to the list <section> that holds the "Chats" header — this excludes
  // the chat-header's own "More actions" menu, which shares the label. The
  // seeded org has no projects, so the only row-actions menu inside this
  // section belongs to a chat row; our freshly created thread is the newest
  // un-projected (unpinned) chat, so it's the first such row.
  const listSection = page
    .locator('section')
    .filter({
      has: page.getByText(t('chat.chatsSection'), { exact: true }),
    })
    .first();
  const rowActions = listSection
    .getByRole('button', { name: t('chat.moreActions') })
    .first();
  await rowActions.scrollIntoViewIfNeeded();
  await rowActions.click();

  await page
    .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
    .click();

  // DeleteDialog confirm button is labelled "Delete chat".
  await page
    .getByRole('button', { name: t('chat.deleteChat'), exact: true })
    .click();

  // Deleting the open thread routes back to the base chat surface.
  await page.waitForURL(/\/chat(?:[/?#]|$)/, { timeout: 60_000 });
});
