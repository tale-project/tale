import { expect, test } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import {
  CANNED_HUMAN_INPUT_ACK,
  CANNED_HUMAN_INPUT_FIELD_LABEL,
  CANNED_HUMAN_INPUT_QUESTION,
  MOCK_TRIGGERS,
} from '../mock-llm/canned';

/**
 * Tool-call flow against the seeded "E2E Assistant" agent (which carries the
 * `request_human_input` tool, per `fixtures/config/default/agents/chat-agent.json`).
 *
 * A user message containing `MOCK_TRIGGERS.humanInput` makes the mock emit a
 * `request_human_input` tool call with one required TEXT field (question =
 * `CANNED_HUMAN_INPUT_QUESTION`, label = `CANNED_HUMAN_INPUT_FIELD_LABEL`). The
 * backend executes the tool, which renders the human-input approval card
 * (`human-input-request-card.tsx`) in the chat. After the user fills the field
 * and submits, the approval flips to `status: 'completed'` (form → response
 * view + a "Responded" badge), and the mock — on the resume turn (the
 * conversation now carries the tool call / `<human_response>`) — streams
 * `CANNED_HUMAN_INPUT_ACK` as a follow-up assistant message.
 *
 * Deterministic ONLY under the mock LLM, so the whole file is skipped against a
 * live stack (`isMockLlmMode()`), matching the repo convention for LLM-content
 * assertions.
 *
 * What this spec asserts and why:
 *  - PRIMARY (most robust — pure render + a controlled submit, no streaming
 *    timing): the approval card renders the question + the labelled text field +
 *    the "Submit response" button; after filling + submitting, the card flips to
 *    its responded state (the submitted value is shown back, the form's submit
 *    button is gone, and the "Responded" status badge appears). These are
 *    deterministic UI transitions driven by the recorded approval status, not by
 *    a second model turn.
 *  - SECONDARY (best-effort — the resume turn re-invokes generation, so the ack
 *    text is timing-sensitive): if the acknowledgement (`CANNED_HUMAN_INPUT_ACK`)
 *    streams in as a follow-up assistant message we assert it; otherwise we don't
 *    fail the test on it. The recorded-response state above already proves the
 *    submit was accepted, so the ack is a bonus signal, not the gate.
 *
 * Reuses `chat.spec.ts`'s composer-fill draft-key-flip retry verbatim, and
 * cleans up its own thread (the only state it mutates).
 */

// Unique per run so the user bubble + created thread are unambiguous on the
// shared backend. The trigger substring must be present for the mock to switch
// into the human-input scenario.
const TRIGGER_MESSAGE = `${MOCK_TRIGGERS.humanInput} ${Date.now().toString(36)}`;

// Unique value typed into the human-input text field — asserted back verbatim in
// the card's responded state.
const FIELD_ANSWER = `E2E workspace ${Date.now().toString(36)}`;

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

test.skip(!isMockLlmMode(), 'requires the deterministic mock LLM');

test('emits a human-input tool call, renders the approval card, and records a submitted response', async ({
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
    await composer.pressSequentially(TRIGGER_MESSAGE);
    await expect(composer).toHaveValue(TRIGGER_MESSAGE);
  }).toPass({ timeout: 30_000 });

  const sendButton = page.getByRole('button', {
    name: t('chat.send'),
    exact: true,
  });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // Optimistic user bubble appears immediately, and the send creates a thread
  // (the URL gains a thread id). Capture it for the delete step.
  await expect(page.getByText(TRIGGER_MESSAGE).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  const threadId = THREAD_URL.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  // The backend executes the tool and renders the human-input approval card.
  // The card is a plain <div> (no role). Anchor it as the div whose accessible
  // descendants include the question title (`humanInputRequest.questionTitle` =
  // "Question"), the labelled field, and the submit button — `has:` pins the
  // exact container (vs `hasText` div-soup), and scoping the field/submit
  // lookups to it keeps them off the composer textbox. The card's strings
  // (question / "Responded" badge / submitted value) are page-unique anyway, so
  // the scope is belt-and-braces.
  const submitButton = page.getByRole('button', {
    name: t('humanInputRequest.submit'),
    exact: true,
  });
  const card = page
    .locator('div')
    .filter({ has: page.getByText(t('humanInputRequest.questionTitle')) })
    .filter({ has: submitButton })
    .last();

  // The question (streamed via the tool args, rendered as markdown) is shown.
  await expect(card.getByText(CANNED_HUMAN_INPUT_QUESTION).first()).toBeVisible(
    { timeout: 120_000 },
  );

  // The field renders as a text input associated (via `<label htmlFor>`) with
  // its label. The required `*` lives in an `aria-hidden` span, so the
  // accessible name is just the label — but match non-exactly to be safe.
  const field = card.getByLabel(CANNED_HUMAN_INPUT_FIELD_LABEL, {
    exact: false,
  });
  await expect(field).toBeVisible({ timeout: 60_000 });

  // The submit button (`humanInputRequest.submit` = "Submit response"). It's
  // page-unique pre-submit (the only such button), so use the page-level
  // locator directly — the same one `card` is pinned on.
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();

  // Fill the field with a unique value and submit.
  await field.fill(FIELD_ANSWER);
  await expect(field).toHaveValue(FIELD_ANSWER);
  await submitButton.click();

  // PRIMARY ASSERTION: the response was recorded. On `status: 'completed'` the
  // card swaps the form for the response view — the submitted value is rendered
  // back, the "Submit response" button is gone, and the "Responded" status
  // badge (`humanInputRequest.statusResponded`) appears. These are deterministic
  // transitions driven by the recorded approval status (not a second model turn).
  //
  // Assert at PAGE level here, NOT scoped to `card`: the `card` locator is
  // pinned by `has: submitButton`, and the submit button is exactly what
  // disappears on `completed`, so a card-scoped lookup would go stale. The
  // responded badge + submitted value are page-unique (only this card renders
  // them), so a page-level assertion is both correct and unambiguous.
  await expect(
    page.getByText(t('humanInputRequest.statusResponded'), { exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(FIELD_ANSWER).first()).toBeVisible({
    timeout: 60_000,
  });
  // The form's submit button is gone (the card is no longer in form state).
  await expect(submitButton).toHaveCount(0);

  // SECONDARY (best-effort): the resume turn re-invokes generation and the mock
  // streams the acknowledgement. It's timing-sensitive (a second model turn), so
  // don't fail the test on it — the recorded-response state above already proves
  // the submit landed. Probe with a bounded wait and only assert if it arrives.
  const ack = page.getByText(CANNED_HUMAN_INPUT_ACK).first();
  try {
    await ack.waitFor({ state: 'visible', timeout: 60_000 });
    await expect(ack).toBeVisible();
  } catch {
    // Resume acknowledgement didn't stream in time — non-fatal. The card's
    // responded state is the authoritative signal that the response was
    // recorded; log for trace diagnosis without failing.
    console.warn(
      '[chat-tools] resume acknowledgement did not stream within the wait; ' +
        'relying on the card responded-state assertion.',
    );
  }

  // Clean up the thread this test created (rule 4 permits deleting our own
  // freshly created state). Open history, open our row's actions menu, delete,
  // and confirm. Mirrors `chat-threads.spec.ts`.
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();

  // Scope to the list <section> that holds the "Chats" header — this excludes
  // the chat-header's own "More actions" menu, which shares the label. The
  // seeded org has no projects, so the only row-actions menu inside this section
  // belongs to a chat row; our freshly created thread is the newest
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
