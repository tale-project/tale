import { CANNED_REPLY } from '../../../lib/mocks/overrides/canned';
import {
  assistantMessages,
  deleteThreadById,
  fillComposer,
  sendButton,
  sendNewThreadMessage,
} from '../helpers/chat';
import { TIMEOUT, isMockLlmMode } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';

/**
 * Chat time-to-first-words budget (mock stack only).
 *
 * The mock provider answers instantly, so click→reply wall time here is pure
 * platform pipeline: mutation → scheduled node action → config/guardrails →
 * streamText → delta flush → reactive render. The 2026-07 TTFT investigation
 * (#2776, PR #2777) measured this floor at ~0.8–1.0s locally; the regression
 * class this spec guards against — a serial classifier hop on pinned turns,
 * forced thinking, a de-parallelized pipeline — costs MULTIPLE seconds, so
 * the bands sit generously above CI-runner noise and far below any real
 * regression. The first turn (navigation + thread creation) is a warm-up and
 * is not timed; the three follow-ups are timed from the send CLICK to the
 * reply becoming visible.
 *
 * Budget anchored to `sla-targets.ts` `dialog_ttft` (~1s mean in production):
 * median of three warm turns < 3.5s, worst single turn < 8s.
 */

test.skip(!isMockLlmMode(), 'perf budget is only deterministic under the mock');

const MEDIAN_BUDGET_MS = 3_500;
const WORST_BUDGET_MS = 8_000;

const chatUrl = (organizationId: string) => `/dashboard/${organizationId}/chat`;

test('three warm mock turns stay inside the first-words budget', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(chatUrl(organizationId));

  const salt = Date.now().toString(36);

  // Untimed warm-up: creates the thread (navigation-heavy) and absorbs any
  // cold module import after a fresh push.
  const threadId = await sendNewThreadMessage(page, `ttft warmup ${salt}`);
  await expect(
    assistantMessages(page).nth(0).getByText(CANNED_REPLY),
  ).toBeVisible({ timeout: TIMEOUT.REPLY });

  const durations: number[] = [];
  for (let turn = 1; turn <= 3; turn++) {
    const message = `ttft probe ${salt} turn ${turn}`;
    await fillComposer(page, message);
    await expect(sendButton(page)).toBeEnabled();
    const before = Date.now();
    await sendButton(page).click();
    await expect(
      assistantMessages(page).nth(turn).getByText(CANNED_REPLY),
    ).toBeVisible({ timeout: TIMEOUT.REPLY });
    durations.push(Date.now() - before);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[1];
  const worst = sorted[2];

  expect(
    median,
    `median first-words ${median}ms over budget (turns: ${durations.join(', ')}ms)`,
  ).toBeLessThan(MEDIAN_BUDGET_MS);
  expect(
    worst,
    `worst first-words ${worst}ms over budget (turns: ${durations.join(', ')}ms)`,
  ).toBeLessThan(WORST_BUDGET_MS);

  await deleteThreadById(page, threadId);
});
