import { expect, test } from '@playwright/test';

import { t } from '../helpers/i18n';
import { isMockLlmMode, readRunContext } from '../helpers/test-context';
import { CANNED_REPLY } from '../mock-llm/canned';

/**
 * Chat send + stream smoke flow against the seeded E2E agent. In mock-LLM
 * mode (default) the assistant reply is the canned text streamed by
 * `e2e/mock-llm/server.ts`; against a live stack (E2E_MOCK_LLM=0) only the
 * round-trip is asserted, not the content.
 */

const MESSAGE = 'Hello from the Playwright E2E suite';

test('sends a chat message and receives a streamed reply', async ({ page }) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/chat`);

  const composer = page.getByRole('textbox', {
    name: t('chat.aria.chatInput'),
  });
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(composer).toBeEnabled();

  // The composer's draft is keyed on the resolved user id; that key flips once
  // auth settles, and the flip re-seeds the (controlled) textarea from
  // storage, dropping characters typed before it lands. So a single
  // type-then-send can ship a truncated message. Retry the clear+type until
  // the value actually sticks (the key flips at most once, so a later attempt
  // always wins), then send — guaranteeing the full message reaches the turn.
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

  // The user bubble appears immediately (optimistic send).
  await expect(page.getByText(MESSAGE).first()).toBeVisible({
    timeout: 30_000,
  });

  if (isMockLlmMode()) {
    // The streamed assistant reply is canned, so assert the exact content.
    await expect(page.getByText(CANNED_REPLY).first()).toBeVisible({
      timeout: 120_000,
    });
  } else {
    // Live LLM: assert the turn completes (the Stop affordance reverts to
    // Send once streaming finishes).
    await expect(
      page.getByRole('button', { name: t('chat.send'), exact: true }),
    ).toBeVisible({ timeout: 120_000 });
  }
});
