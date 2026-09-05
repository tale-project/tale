import { describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';

import type { BuilderModel } from '../../../lib/automations_builder/session';
import type { DispatchStore } from '../../../lib/engine/api/dispatch';
import type { Automation } from '../../../lib/engine/core/types';
import { memoryStore } from '../../../lib/engine/store/memory';
import type { ActionCtx } from '../lib/ctx';
import { runSessionWithStore } from './run_session';

/** The host's model seam, replaced by a scripted model that keeps asking the
 * catalog — a session that never finishes on its own, so only the caller's
 * cancellation can end it. */
const modelCalls = vi.fn();
vi.mock('./model_call', () => ({
  createBuilderModel: (): BuilderModel => async (request) => {
    modelCalls(request.turn);
    return {
      content: `Looking.\n\`\`\`yaml\n${stringifyYaml({
        method: 'search_catalog',
        params: { query: `attempt ${request.turn}` },
      })}\`\`\``,
      usage: { prompt: 10, completion: 5 },
    };
  },
}));

function store(): DispatchStore {
  const mem = memoryStore();
  return {
    list: () => mem.list(),
    get: (name, version) => mem.get(name, version),
    deployedVersion: (name) => mem.deployedVersion(name),
    async save(automation: Automation, message?: string) {
      const { version } = mem.save(automation.name, automation, message);
      return { name: automation.name, version };
    },
    async deploy(name: string, version: number) {
      mem.deploy(name, version);
      return { name, version };
    },
  };
}

describe('runSessionWithStore', () => {
  it('ends the session as cancelled when the host reports the caller is gone', async () => {
    // Regression: the host never forwarded a cancellation seam, so the
    // `cancelled` outcome its type advertises was unreachable and an
    // abandoned request kept spending model turns up to the policy ceiling.
    let turnsSeen = 0;
    modelCalls.mockImplementation((turn: number) => {
      turnsSeen = turn;
    });
    const outcome = await runSessionWithStore(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked model never touches the ctx
      {} as ActionCtx,
      {
        organizationId: 'org_1',
        actorId: 'user_1',
        goal: 'summarize qualifying orders for the sales team',
        model: { providerSlug: 'openai', modelId: 'gpt-test' },
        maxTurns: 14,
        isCancelled: () => turnsSeen >= 2,
      },
      store(),
    );
    expect(outcome.status).toBe('cancelled');
    expect(outcome.reason).toBe('the caller cancelled the session');
    expect(outcome.turns).toBe(2);
    expect(modelCalls).toHaveBeenCalledTimes(2);
  });
});
