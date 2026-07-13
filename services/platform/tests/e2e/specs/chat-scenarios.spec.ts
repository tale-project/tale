import type { Page } from '@playwright/test';

import {
  CANNED_ERROR_MESSAGE,
  CANNED_FILE_WRITE_ACK,
  CANNED_HUMAN_INPUT_ACK,
  CANNED_HUMAN_INPUT_FIELD_LABEL,
  CANNED_HUMAN_INPUT_QUESTION,
  CANNED_NEXT_STEPS_ITEMS,
  CANNED_PLAN_ACK,
  CANNED_PLAN_TODOS,
  CANNED_REASONING,
  CANNED_REASONING_ANSWER,
  CANNED_REPLY,
  MOCK_TRIGGERS,
} from '../../../lib/mocks/overrides/canned';
import {
  assistantMessages,
  composer,
  deleteThreadById,
  fillComposer,
  messageLog,
  sendButton,
  sendNewThreadMessage,
} from '../helpers/chat';
import { TIMEOUT, isMockLlmMode } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { SEEDED_AGENT_DISPLAY_NAME } from '../helpers/seed';

/**
 * Mock-only chat scenarios: the keyword-gated branches the mock LLM streams
 * (reasoning / next-steps / human-input / arena / induced error). Each is
 * deterministic ONLY under the mock fixture, so the whole file is skipped on a
 * live stack. Every test sends its trigger, asserts its unique signal, and
 * deletes the thread it created.
 */

test.skip(!isMockLlmMode(), 'mock-only scenarios');

const chatUrl = (organizationId: string) => `/dashboard/${organizationId}/chat`;

test('reasoning: streams a collapsed "Thinking" disclosure that expands on click', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `${MOCK_TRIGGERS.reasoning} reasoning probe ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));
  const threadId = await sendNewThreadMessage(page, message);

  // The final answer (streamed after the reasoning block) renders.
  await expect(page.getByText(CANNED_REASONING_ANSWER).first()).toBeVisible({
    timeout: TIMEOUT.REPLY,
  });

  // The reasoning disclosure (`thought-header.tsx` → the in-bubble
  // `MessageThoughtHeader`) is the ONLY `aria-expanded` toggle in this scenario's
  // assistant bubble — there are no tool/workflow cards here. Its accessible name
  // is the live, state-based label, which has ALREADY latched to the completed
  // summary ("Thought for Ns" / "Showed its reasoning") by the time the answer is
  // visible, so a `name: "Thinking"` match would miss it; anchor on the stable
  // `aria-expanded` attribute instead. The header's always-visible status strip
  // is a plain `<div>`, so the button role still disambiguates the two.
  const reasoningToggle = assistantMessages(page)
    .last()
    .locator('button[aria-expanded]')
    .first();
  await expect(reasoningToggle).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // COLLAPSED by default (user-controlled — it never auto-expands); the prose
  // stays hidden until clicked.
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(CANNED_REASONING).first()).toBeHidden();

  await reasoningToggle.click();
  await expect(reasoningToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(CANNED_REASONING).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  await deleteThreadById(page, threadId);
});

test('next-steps: renders follow-up buttons and a click sends the item as a new turn', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `${MOCK_TRIGGERS.nextSteps} draft a plan ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));
  const threadId = await sendNewThreadMessage(page, message);

  // The structured block renders inside a region labelled by the
  // `chat.structured.nextSteps` header; each canned item is its own clickable
  // follow-up button (accessible name = the item text).
  const nextStepsSection = page.getByRole('region', {
    name: t('chat.structured.nextSteps'),
  });
  await expect(nextStepsSection).toBeVisible({ timeout: TIMEOUT.REPLY });
  for (const item of CANNED_NEXT_STEPS_ITEMS) {
    await expect(
      nextStepsSection.getByRole('button', { name: item, exact: true }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  }

  // The `[[NEXT_STEPS]]` marker is structural — the parser strips it, so it
  // must never leak as literal text.
  await expect(page.getByText('[[NEXT_STEPS]]')).toHaveCount(0);

  // Clicking a follow-up POPULATES the composer (handleSendFollowUp →
  // setInputValue); it does not auto-send. Retry the click→value assertion.
  const firstItem = CANNED_NEXT_STEPS_ITEMS[0];
  const firstFollowUp = nextStepsSection.getByRole('button', {
    name: firstItem,
    exact: true,
  });
  await expect(async () => {
    await firstFollowUp.click();
    await expect(composer(page)).toHaveValue(firstItem);
  }).toPass({ timeout: TIMEOUT.VISIBLE });

  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();

  // The item now appears as a USER BUBBLE — a `<p>`, distinct from the
  // still-present follow-up `<button>` of the same text. `.and(p)` matches only
  // the paragraph bubble.
  await expect(
    messageLog(page)
      .getByText(firstItem, { exact: true })
      .and(page.locator('p')),
  ).toBeVisible({ timeout: TIMEOUT.REPLY });

  await deleteThreadById(page, threadId);
});

test('human-input: renders the approval card and records a submitted response', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `${MOCK_TRIGGERS.humanInput} ${Date.now().toString(36)}`;
  const fieldAnswer = `E2E workspace ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));
  const threadId = await sendNewThreadMessage(page, message);

  // The backend executes the tool and renders the human-input approval card (a
  // plain div, no role). Anchor it as the div whose descendants include the
  // question title and the submit button.
  const submitButton = page.getByRole('button', {
    name: t('humanInputRequest.submit'),
    exact: true,
  });
  const card = page
    .locator('div')
    .filter({ has: page.getByText(t('humanInputRequest.questionTitle')) })
    .filter({ has: submitButton })
    .last();

  await expect(card.getByText(CANNED_HUMAN_INPUT_QUESTION).first()).toBeVisible(
    {
      timeout: TIMEOUT.REPLY,
    },
  );

  // The field is a text input associated via `<label htmlFor>` (the required `*`
  // is aria-hidden, so match the label non-exactly).
  const field = card.getByLabel(CANNED_HUMAN_INPUT_FIELD_LABEL, {
    exact: false,
  });
  await expect(field).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(submitButton).toBeEnabled();

  await field.fill(fieldAnswer);
  await expect(field).toHaveValue(fieldAnswer);
  await submitButton.click();

  // On `status: 'completed'` the card swaps the form for the response view: the
  // submitted value is rendered back and the "Responded" badge appears (the
  // submit button is gone). Assert at PAGE level — these are page-unique, and
  // the card locator is pinned on the now-removed submit button.
  await expect(
    page.getByText(t('humanInputRequest.statusResponded'), { exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.REPLY });
  await expect(page.getByText(fieldAnswer).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await expect(submitButton).toHaveCount(0);

  // SECONDARY (best-effort): the resume turn re-invokes generation and streams
  // the acknowledgement. Timing-sensitive, so probe without failing on it — the
  // responded state above already proves the submit landed.
  const ack = page.getByText(CANNED_HUMAN_INPUT_ACK).first();
  try {
    await ack.waitFor({ state: 'visible', timeout: TIMEOUT.REPLY });
    await expect(ack).toBeVisible();
  } catch {
    console.warn(
      '[chat-scenarios] resume acknowledgement did not stream within the wait; ' +
        'relying on the card responded-state assertion.',
    );
  }

  await deleteThreadById(page, threadId);
});

test('arena: enables two-model compare, streams both columns, records a verdict, then exits', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `arena probe ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));
  await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Arena compares two models on ONE chosen agent and refuses to run in Auto
  // (`arenaRequiresAgent`). Pin the seeded agent FIRST — the AgentSelector is
  // swapped for the ArenaModelSelector once arena is on.
  const agentTrigger = page
    .getByRole('button', { name: t('chat.agentSelector.label') })
    .first();
  await expect(agentTrigger).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
  await agentTrigger.click();
  await page
    .getByRole('option', { name: SEEDED_AGENT_DISPLAY_NAME })
    .first()
    .click();
  await expect(agentTrigger).toContainText(SEEDED_AGENT_DISPLAY_NAME, {
    timeout: TIMEOUT.VISIBLE,
  });

  // Enable arena via the composer mode menu (the "+" button → "Arena Mode").
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.arena.label'), exact: true })
    .click();

  // The Model A / Model B triggers only render in arena mode AND only with ≥2
  // accessible models — their appearance proves arena is on with both fixture
  // models synced (`.first()` because the SearchableSelect shares the label).
  await expect(
    page.getByRole('button', { name: t('chat.arena.modelA') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    page.getByRole('button', { name: t('chat.arena.modelB') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Send a prompt; the new-chat arena path creates Thread A + Thread B and
  // navigates to Thread A. Reuse the shared send (it returns Thread A's id).
  const threadId = await sendNewThreadMessage(page, message);

  // The verdict bar mounts ONLY when both arena thread ids exist, so its
  // presence proves both columns are live.
  const verdictBar = page.getByRole('group', {
    name: t('chat.arena.verdictLabel'),
  });
  await expect(verdictBar).toBeVisible({ timeout: TIMEOUT.REPLY });

  // Both columns stream the same canned reply, so ≥2 matches proves both split
  // columns streamed.
  const replies = page.getByText(CANNED_REPLY);
  await expect(async () => {
    expect(await replies.count()).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: TIMEOUT.REPLY });

  // Record a verdict ("A is better"); the verdict buttons lock on success.
  await verdictBar
    .getByRole('button', { name: t('chat.arena.aBetter'), exact: true })
    .click();
  await expect(
    page.getByText(t('chat.arena.verdictRecorded')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    verdictBar.getByRole('button', {
      name: t('chat.arena.aBetter'),
      exact: true,
    }),
  ).toBeDisabled({ timeout: TIMEOUT.VISIBLE });

  // Exit arena (toggle the mode item off) — the verdict bar disappears.
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.arena.label'), exact: true })
    .click();
  await expect(verdictBar).toBeHidden({ timeout: TIMEOUT.VISIBLE });

  // Verdict 'a_better' keeps Thread A, so cleanup deletes the surviving thread.
  await deleteThreadById(page, threadId);
});

test('error: surfaces the provider-failure UI when the generation call returns 500', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `${MOCK_TRIGGERS.error} ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));

  // The mock fails ONLY the streaming generation call (router/title still get
  // the canned JSON), so the failure lands on the assistant turn. Send via the
  // composer directly — the error may prevent a thread from being created, so
  // don't gate on `sendNewThreadMessage`'s thread-id assertion.
  await fillComposer(page, message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
  await expect(page.getByText(message).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // The failed assistant turn renders its `role="alert"` notice headed by
  // `chat.errorGenerating` ("Something went wrong") — `message-bubble.tsx`'s
  // `message.isFailed` branch. This is the always-present failure signal (the
  // retry button is conditional on an onRetry handler).
  const errorNotice = page.getByRole('alert').filter({
    has: page.getByText(t('chat.errorGenerating'), { exact: true }),
  });
  await expect(errorNotice).toBeVisible({ timeout: TIMEOUT.REPLY });

  // The SDK wraps the upstream 500 into a retry-exhausted message
  // ("Failed after N attempts. Last error: <CANNED_ERROR_MESSAGE>"), which
  // carries no bare HTTP status or "server error" token — so `sanitizeChatError`
  // falls through every typed pattern to the `generic` bucket. That renders the
  // neutral `errorGeneratingDescription` hint AND preserves the raw provider
  // message verbatim (the `rawMessage` paragraph). Assert both: the hint copy,
  // and the canned induced-error text proving the failure came from the mock's
  // generation call.
  await expect(
    errorNotice.getByText(t('chat.errorGeneratingDescription')),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(errorNotice.getByText(CANNED_ERROR_MESSAGE)).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // Best-effort cleanup: routing succeeds, so a thread id usually lands in the
  // URL even though the generation failed. Delete it only if it exists.
  const threadId = /\/chat\/([A-Za-z0-9]{16,})/.exec(page.url())?.[1];
  if (threadId) await deleteThreadById(page, threadId);
});

// The right-hand workspace panel is a shared tablist host (`chat-panel.tsx`):
// each pane publishes a `role="tab"` (accessible name = its `ariaLabel`) and
// its body renders in a `role="tabpanel"`. Panes `useAutoOpen` when they gain
// content, but auto-open can race the assertion, so click the tab defensively —
// clicking the already-active tab is a no-op.
async function openWorkspaceTab(page: Page, tabName: string): Promise<void> {
  const tab = page.getByRole('tab', { name: tabName });
  await expect(tab).toBeVisible({ timeout: TIMEOUT.REPLY });
  await tab.click();
}

test('file-write: the canvas pane renders workspace files the mock wrote (#2688)', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `${MOCK_TRIGGERS.fileWrite} produce deliverables ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));
  const threadId = await sendNewThreadMessage(page, message);

  // The mock emits `file_write` tool calls (which execute server-side, no
  // sandbox), the agent loops, and the resume turn streams the plain-text ack —
  // proof the files were written and the turn completed.
  await expect(page.getByText(CANNED_FILE_WRITE_ACK).first()).toBeVisible({
    timeout: TIMEOUT.REPLY,
  });

  // The canvas pane registered a tab (proof it has files); open it. Its file
  // explorer is a `role="tree"` labelled "Canvas" (`canvas-file-tree.tsx`),
  // grouped by source; the written markdown deliverable is one of its rows.
  await openWorkspaceTab(page, t('chat.canvas.stripOpen'));
  const canvasTree = page.getByRole('tree', { name: t('chat.canvas.title') });
  await expect(canvasTree).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(canvasTree.getByText('report.md')).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  await deleteThreadById(page, threadId);
});

test('plan: the research-plan pane renders the todos the mock seeded (#2688)', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const message = `${MOCK_TRIGGERS.plan} outline the work ${Date.now().toString(36)}`;

  await page.goto(chatUrl(organizationId));
  const threadId = await sendNewThreadMessage(page, message);

  // The mock emits one `update_todos` call (executes server-side), then acks.
  await expect(page.getByText(CANNED_PLAN_ACK).first()).toBeVisible({
    timeout: TIMEOUT.REPLY,
  });

  // The plan pane registered a tab; open it and assert the seeded todos list.
  await openWorkspaceTab(page, t('todoList.stripOpen'));
  const planPanel = page.getByRole('tabpanel');
  for (const todo of CANNED_PLAN_TODOS) {
    await expect(planPanel.getByText(todo.content).first()).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
  }

  await deleteThreadById(page, threadId);
});
