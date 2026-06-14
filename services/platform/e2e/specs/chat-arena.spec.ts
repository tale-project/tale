import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import { CANNED_REPLY } from '../mock-llm/canned';

/**
 * Arena (two-model compare) flow against the seeded E2E agent. The fixture
 * provider ships TWO chat models ("E2E Chat Model", "E2E Chat Model B") and the
 * seeded "E2E Assistant" agent supports both, so arena mode is available (the
 * arena composer-menu entry compares two models on ONE chosen agent, and the
 * `ArenaModelSelector` only mounts when ≥2 models are accessible).
 *
 * Both models stream `CANNED_REPLY` from the mock, so the split-view CONTENT
 * assertions are gated behind `isMockLlmMode()` — there is no deterministic
 * arena content against a live stack.
 *
 * Flow (one sequential test — arena is stateful: enabling it, sending, and the
 * verdict all live on the same thread pair, so splitting would mean rebuilding
 * the pair each time):
 *   1. Pin the seeded agent (arena needs a CONCRETE agent — see the
 *      `arenaRequiresAgent` guard in `use-send-message.ts`; the AgentSelector is
 *      swapped out for the ArenaModelSelector once arena is on, so pin first).
 *   2. Enable arena via the composer mode menu (the "+" button → "Arena Mode"
 *      menuitem). Assert arena activated: the composer swaps to the
 *      ArenaModelSelector (Model A / Model B triggers appear — these only render
 *      in arena mode with ≥2 models), which also confirms both models synced.
 *   3. Send a prompt. Assert the split view renders BOTH columns and each
 *      streams `CANNED_REPLY` (mock-gated). The verdict bar only mounts once
 *      BOTH arena thread ids exist, so its presence doubles as proof that the
 *      two columns (= two threads) are live.
 *   4. Click a verdict (A is better). Assert it's recorded (the "Verdict
 *      recorded" toast + the verdict buttons lock/disable).
 *   5. Exit arena and delete the thread the run created (cleanup, best-effort).
 *
 * --- SELECTOR PROVENANCE (this spec drives UI validated against source but not
 * run, so each selector cites where it comes from) ---
 *   - Composer menu trigger: `composer-mode-menu.tsx` → `aria-label`
 *     `t('composer.openMenu')`; arena item → `menuitem` named `t('chat.arena.label')`.
 *   - Arena model triggers: `arena-model-selector.tsx` → buttons `aria-label`
 *     `t('chat.arena.modelA')` / `t('chat.arena.modelB')` (present only in arena
 *     mode; the SearchableSelect wrapper carries the same label, hence `.first()`).
 *   - Split view + columns: `arena-split-view.tsx` → two `ArenaColumn`s, each a
 *     `ChatMessages`; `ArenaVerdictBar` renders only when both thread ids exist.
 *   - Verdict bar: `arena-verdict-bar.tsx` → `role="group"` named
 *     `t('chat.arena.verdictLabel')`, four `Button`s (a_better/b_better/tie/
 *     both_bad); a recorded verdict toasts `t('chat.arena.verdictRecorded')` and
 *     disables every verdict button.
 *   - Agent pin / Send: mirrors `chat-depth.spec.ts` / `chat.spec.ts` verbatim.
 */

// The seeded agent's DISPLAY NAME, from
// `fixtures/config/default/agents/chat-agent.json`. Fixture content (not
// translated UI copy), so it stays a single literal — mirrors
// `chat-depth.spec.ts`'s `SEEDED_AGENT_DISPLAY_NAME`.
const SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant';

// Unique per run so the user bubble is unambiguous on the shared backend
// (rule 4). No trigger keyword → both models stream the plain `CANNED_REPLY`.
const ARENA_MESSAGE = `E2E arena probe ${Date.now().toString(36)}`;

// A thread id is appended to the URL once arena creates the pair (Thread A is
// the routed-to thread). Mirrors `chat-threads.spec.ts`'s `THREAD_URL`.
const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

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

// Arena's two-model premise only holds under the mock fixture — a live stack
// (E2E_MOCK_LLM=0) uses a different config dir without these two models — so
// skip in live mode, consistent with the other group-B (mock-driven) specs.
test.beforeEach(() => {
  test.skip(
    !isMockLlmMode(),
    'requires the deterministic mock LLM + two-model fixture',
  );
});

test('enables arena mode, streams both columns, records a verdict, then exits', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });

  // --- 1. Pin the seeded agent ----------------------------------------------
  // Arena compares two models on ONE chosen agent and refuses to run in Auto
  // (`use-send-message.ts`: `if (isArena && !selectedAgent)` → the
  // `arenaRequiresAgent` toast). Pinning the concrete seeded agent guarantees a
  // non-Auto selection. The AgentSelector is swapped out for the
  // ArenaModelSelector once arena is enabled, so this MUST happen first.
  // Pattern mirrors `chat-depth.spec.ts`.
  const agentTrigger = page
    .getByRole('button', { name: t('chat.agentSelector.label') })
    .first();
  await expect(agentTrigger).toBeEnabled({ timeout: 60_000 });
  await agentTrigger.click();
  await page
    .getByRole('option', { name: SEEDED_AGENT_DISPLAY_NAME })
    .first()
    .click();
  await expect(agentTrigger).toContainText(SEEDED_AGENT_DISPLAY_NAME, {
    timeout: 60_000,
  });

  // --- 2. Enable arena mode via the composer mode menu ----------------------
  // `ArenaModeToggle` (the standalone Swords button) is NOT mounted in the
  // composer; the live entry point is the composer mode menu (the "+" button),
  // whose mode group always carries an "Arena Mode" item while the
  // ArenaModeProvider is mounted (it is, app-wide, on the chat route).
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.arena.label'), exact: true })
    .click();

  // Arena activated: the composer replaces the Agent + Model selectors with the
  // ArenaModelSelector, whose Model A / Model B triggers only render in arena
  // mode AND only when ≥2 models are accessible — so their appearance is the
  // robust signal that arena is on with both fixture models synced. (`.first()`
  // because the SearchableSelect wrapper shares the trigger's aria-label.)
  const modelATrigger = page
    .getByRole('button', { name: t('chat.arena.modelA') })
    .first();
  const modelBTrigger = page
    .getByRole('button', { name: t('chat.arena.modelB') })
    .first();
  await expect(modelATrigger).toBeVisible({ timeout: 60_000 });
  await expect(modelBTrigger).toBeVisible({ timeout: 60_000 });

  // --- 3. Send a prompt; assert BOTH columns render + stream ----------------
  await fillComposer(page, ARENA_MESSAGE);
  const sendButton = page.getByRole('button', {
    name: t('chat.send'),
    exact: true,
  });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // The new-chat arena path creates Thread A + Thread B and navigates to
  // Thread A. Capture the id for the cleanup delete at the end.
  await page.waitForURL(THREAD_URL, { timeout: 60_000 });
  const threadId = THREAD_URL.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();

  // The verdict bar mounts ONLY when both arena thread ids exist
  // (`arena-split-view.tsx`), so its presence proves both columns are live.
  const verdictBar = page.getByRole('group', {
    name: t('chat.arena.verdictLabel'),
  });
  await expect(verdictBar).toBeVisible({ timeout: 120_000 });

  if (isMockLlmMode()) {
    // Both columns stream the same canned reply, so the text resolves once per
    // column. Asserting ≥2 matches proves BOTH split columns streamed a reply.
    const replies = page.getByText(CANNED_REPLY);
    await expect(async () => {
      expect(await replies.count()).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 120_000 });
  } else {
    // Live stack: assert only that the turn completed (the composer reverts to
    // the Send affordance once both columns finish streaming).
    await expect(
      page.getByRole('button', { name: t('chat.send'), exact: true }),
    ).toBeVisible({ timeout: 120_000 });
  }

  // --- 4. Record a verdict --------------------------------------------------
  // Scope the button to the verdict group so it can't collide with the chat
  // surface. "A is better" maps to `a_better` (positive rating).
  await verdictBar
    .getByRole('button', { name: t('chat.arena.aBetter'), exact: true })
    .click();

  // Verdict recorded: the success toast fires AND every verdict button locks
  // (`disabled={isSubmitting || selectedVerdict !== null}` in
  // `arena-verdict-bar.tsx`). Assert both for a robust signal.
  await expect(
    page.getByText(t('chat.arena.verdictRecorded')).first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    verdictBar.getByRole('button', {
      name: t('chat.arena.aBetter'),
      exact: true,
    }),
  ).toBeDisabled({ timeout: 60_000 });

  // --- 5. Exit arena + clean up (best-effort) -------------------------------
  // Re-open the composer menu and toggle "Arena Mode" off. `exitArenaMode`
  // runs `cleanupArenaBranch` (verdict='a_better' keeps Thread A) and then
  // disables arena — the verdict bar disappears, confirming the exit.
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.arena.label'), exact: true })
    .click();
  await expect(verdictBar).toBeHidden({ timeout: 60_000 });

  // Delete the thread this run created (rule 4 permits deleting our own freshly
  // created state). Pattern mirrors `chat-threads.spec.ts`: open history, open
  // our row's actions menu (the only chat row in a project-less org), delete,
  // and confirm. Routing back to the base chat surface proves the open thread
  // was removed.
  await page
    .getByRole('button', { name: t('chat.showHistory') })
    .first()
    .click();
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
  await page
    .getByRole('button', { name: t('chat.deleteChat'), exact: true })
    .click();
  await page.waitForURL(/\/chat(?:[/?#]|$)/, { timeout: 60_000 });
});
