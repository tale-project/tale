import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

/**
 * What the agent node editor's preview of a pinless model pick reads,
 * `GET /serving-preview`: the runtime's own resolution, so the editor never
 * drifts from a run. A step that names a runtime asks the walk for that
 * runtime; a step on Default (an empty `harness`) asks the Default
 * resolution the kick uses, and the answer names the runtime it lands on —
 * Pi, or the runtime a subscription serving the model is bound to.
 */

const serving = vi.hoisted(() => ({
  resolveDefaultWorkflowServing: vi.fn(),
  resolveWorkflowAgentServing: vi.fn(),
}));
vi.mock('../../core/lib/providers/agent_serving.ts', () => serving);
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { id: 'u1' } } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (original) => ({
  ...(await original<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'developer' } as never);
      await next();
    },
}));

import { createAutomationRoutes } from './routes.ts';

async function preview(query: string): Promise<unknown> {
  const app = new Hono().route(
    '/api/app/automations',
    createAutomationRoutes({ sql: {} as never, auth: {} as never }),
  );
  const response = await app.request(
    `/api/app/automations/serving-preview?${query}`,
  );
  expect(response.status).toBe(200);
  return response.json();
}

/** A Claude subscription's serving: only Claude Code drives it. */
const SUBSCRIPTION = {
  lane: 'subscription',
  providerSlug: 'anthropic',
  modelId: 'claude-sonnet-5-5',
  apiBaseUrl: 'https://api.anthropic.com',
  vision: { readable: true },
};

beforeEach(() => {
  serving.resolveDefaultWorkflowServing.mockReset();
  serving.resolveWorkflowAgentServing.mockReset();
});

describe('GET /serving-preview', () => {
  it('resolves a step on Default as the kick does, and names the runtime it lands on', async () => {
    serving.resolveDefaultWorkflowServing.mockResolvedValue({
      harness: 'claude-code',
      serving: SUBSCRIPTION,
    });

    await expect(preview('model=claude-sonnet-5-5&harness=')).resolves.toEqual({
      ok: true,
      providerSlug: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      lane: 'subscription',
      harness: 'claude-code',
    });
    expect(serving.resolveDefaultWorkflowServing).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', model: 'claude-sonnet-5-5' },
    );
    expect(serving.resolveWorkflowAgentServing).not.toHaveBeenCalled();
  });

  it('asks a step that names its runtime for that runtime alone', async () => {
    serving.resolveWorkflowAgentServing.mockResolvedValue({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-sonnet-5.5',
    });

    await expect(
      preview('model=claude-sonnet-5-5&harness=codex'),
    ).resolves.toEqual({
      ok: true,
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-sonnet-5.5',
      lane: 'gateway',
      harness: 'codex',
    });
    expect(serving.resolveWorkflowAgentServing).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', model: 'claude-sonnet-5-5', harness: 'codex' },
    );
    expect(serving.resolveDefaultWorkflowServing).not.toHaveBeenCalled();
  });

  it('answers a refusal of the Default resolution as its result, in its words', async () => {
    serving.resolveDefaultWorkflowServing.mockRejectedValue(
      new Error('no configured provider serves model "claude-fable-5"'),
    );

    await expect(preview('model=claude-fable-5')).resolves.toEqual({
      ok: false,
      reason: 'no configured provider serves model "claude-fable-5"',
    });
  });
});
