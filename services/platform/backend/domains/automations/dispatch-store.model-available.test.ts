// @vitest-environment node

/**
 * Unit lock for the pg store's `modelAvailable` — the validator's model
 * check. It rides the llm node's own serving walk, so a warning names
 * exactly what a live run would refuse; it answers once per model per
 * store; and it never manufactures a `false` it cannot stand behind: an
 * unreachable catalog, a subscription lane an agent node might use, or a
 * failure of the lookup all read as "cannot tell" (2026-09-26 evaluation,
 * D-16).
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { walkLlmServing, listServingCredentialFacts } = vi.hoisted(() => ({
  walkLlmServing: vi.fn(),
  listServingCredentialFacts: vi.fn(),
}));

vi.mock('../../core/automations/llm_call.ts', () => ({ walkLlmServing }));
vi.mock('../provider_credentials/service.ts', () => ({
  credentialShimHandlers: () => ({}),
  listServingCredentialFacts,
}));
vi.mock('../chat/shim.ts', () => ({ chatShimHandlers: () => ({}) }));

import { pgAutomationStore } from './dispatch-store.ts';

const sql = {} as unknown as Sql;
const scope = { organizationId: 'org_1', actor: 'user_1' };

beforeEach(() => {
  vi.clearAllMocks();
  listServingCredentialFacts.mockResolvedValue([]);
});

describe('pgAutomationStore.modelAvailable', () => {
  it('answers true when a direct connector serves the model', async () => {
    walkLlmServing.mockResolvedValue({
      target: { providerSlug: 'first', modelId: 'vendor/served' },
      unreachable: [],
      rows: new Map(),
    });
    const store = pgAutomationStore(sql, scope);
    await expect(store.modelAvailable?.('vendor/served', 'llm')).resolves.toBe(
      true,
    );
    expect(walkLlmServing).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'vendor/served',
    );
  });

  it('answers false when nobody serves it, once per model per store', async () => {
    walkLlmServing.mockResolvedValue({
      target: null,
      unreachable: [],
      rows: new Map(),
    });
    const store = pgAutomationStore(sql, scope);
    await expect(store.modelAvailable?.('nobody/serves', 'llm')).resolves.toBe(
      false,
    );
    await expect(store.modelAvailable?.('nobody/serves', 'llm')).resolves.toBe(
      false,
    );
    expect(walkLlmServing).toHaveBeenCalledTimes(1);
  });

  it('cannot tell when a catalog was unreachable', async () => {
    walkLlmServing.mockResolvedValue({
      target: null,
      unreachable: ['second'],
      rows: new Map(),
    });
    const store = pgAutomationStore(sql, scope);
    await expect(
      store.modelAvailable?.('vendor/maybe', 'llm'),
    ).resolves.toBeUndefined();
  });

  it('cannot tell for an agent node while a subscription lane is connected', async () => {
    walkLlmServing.mockResolvedValue({
      target: null,
      unreachable: [],
      rows: new Map(),
    });
    listServingCredentialFacts.mockResolvedValue([
      { providerSlug: 'anthropic', authMethod: 'subscription-broker' },
    ]);
    const store = pgAutomationStore(sql, scope);
    await expect(
      store.modelAvailable?.('claude-fable-5', 'agent'),
    ).resolves.toBeUndefined();
    // The same miss on an llm node IS a miss: llm nodes never ride a
    // subscription lane.
    await expect(store.modelAvailable?.('claude-fable-5', 'llm')).resolves.toBe(
      false,
    );
  });

  it('cannot tell when the lookup itself fails', async () => {
    walkLlmServing.mockRejectedValue(new Error('providers config unreadable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = pgAutomationStore(sql, scope);
    await expect(
      store.modelAvailable?.('vendor/served', 'llm'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
