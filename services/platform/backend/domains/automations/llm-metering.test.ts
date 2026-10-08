/**
 * An automation's `llm` step is its run's spend: each call is opened as a
 * token-priced direct call under the run's own subject
 * (`resolveAutomationRunAttribution`, proven in its suite), holding the
 * prompt and the node's whole output cap, and settled at what the provider
 * reported. The direct-call lease and the attribution are stand-ins; the
 * pricing is `direct-calls.ts`'s and proven there.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';

const mocks = vi.hoisted(() => ({
  resolveAutomationRunAttribution: vi.fn(),
  openTokenCall: vi.fn(),
  settleTokenCall: vi.fn(async () => 'settled'),
  releaseDirectCall: vi.fn(async () => undefined),
}));

vi.mock('../sandbox/op-attribution.ts', () => ({
  resolveAutomationRunAttribution: mocks.resolveAutomationRunAttribution,
}));
vi.mock('../governance/direct-calls.ts', () => ({
  openTokenCall: mocks.openTokenCall,
  settleTokenCall: mocks.settleTokenCall,
  releaseDirectCall: mocks.releaseDirectCall,
}));

const { openLlmStepCall, releaseLlmStepCall, settleLlmStepCall } =
  await import('./llm-metering.ts');

const SQL = {} as Sql;
const LEASE = {
  organizationId: 'org-1',
  sessionId: 'direct-call:llm-step',
  execId: 'exec-1',
  subject: { userId: 'user-2', agentSlug: 'invoices/monthly' },
};
const CALL = {
  organizationId: 'org-1',
  runId: 'run-1',
  automation: 'invoices/monthly',
  provider: 'openrouter',
  model: 'anthropic/claude-haiku-4.5',
  promptTokens: 1_000,
  maxOutputTokens: 8_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openTokenCall.mockResolvedValue({ allowed: true, lease: LEASE });
});

describe('openLlmStepCall', () => {
  it('holds the prompt and the whole output cap under the run’s person, key and projects [GOV-R14]', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: 'user-2',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key-1',
      projectIds: ['project-1', 'project-2'],
    });

    await expect(openLlmStepCall(SQL, CALL)).resolves.toEqual({
      allowed: true,
      lease: LEASE,
    });

    expect(mocks.openTokenCall).toHaveBeenCalledWith(SQL, {
      organizationId: 'org-1',
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
      lane: 'llm-step',
      subject: {
        userId: 'user-2',
        agentSlug: 'invoices/monthly',
        apiKeyId: 'key-1',
        projectIds: ['project-1', 'project-2'],
      },
      promptTokens: 1_000,
      maxOutputTokens: 8_000,
      maxDurationMs: expect.any(Number),
    });
  });

  it('holds a run a trigger started as nobody’s, and a run it cannot read as the organization’s', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValueOnce({
      userId: AUTOMATION_SUBJECT_ID,
      agentSlug: 'invoices/monthly',
      projectIds: ['project-1'],
    });
    await openLlmStepCall(SQL, CALL);
    expect(mocks.openTokenCall).toHaveBeenLastCalledWith(
      SQL,
      expect.objectContaining({
        subject: {
          userId: AUTOMATION_SUBJECT_ID,
          agentSlug: 'invoices/monthly',
          projectIds: ['project-1'],
        },
      }),
    );

    mocks.resolveAutomationRunAttribution.mockResolvedValueOnce(null);
    await openLlmStepCall(SQL, CALL);
    expect(mocks.openTokenCall).toHaveBeenLastCalledWith(
      SQL,
      expect.objectContaining({
        subject: {
          userId: AUTOMATION_SUBJECT_ID,
          agentSlug: 'invoices/monthly',
        },
      }),
    );
  });

  it('answers a refusal with the cap’s own sentence and no lease [GOV-R4]', async () => {
    mocks.resolveAutomationRunAttribution.mockResolvedValue({
      userId: 'user-2',
      agentSlug: 'invoices/monthly',
    });
    mocks.openTokenCall.mockResolvedValue({
      allowed: false,
      reason:
        "Usage limit reached. This project's monthly cost limit is used up until 2026-11-01T00:00:00.000Z.",
      violation: { scope: 'project' },
    });

    await expect(openLlmStepCall(SQL, CALL)).resolves.toEqual({
      allowed: false,
      reason:
        "Usage limit reached. This project's monthly cost limit is used up until 2026-11-01T00:00:00.000Z.",
    });
  });
});

describe('settleLlmStepCall and releaseLlmStepCall', () => {
  it('books the reported tokens at the catalog price in the hold’s place', async () => {
    await settleLlmStepCall(SQL, {
      organizationId: 'org-1',
      lease: LEASE,
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
      inputTokens: 120,
      outputTokens: 30,
    });

    expect(mocks.settleTokenCall).toHaveBeenCalledWith(SQL, LEASE, {
      organizationId: 'org-1',
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it('releases a hold without booking anything', async () => {
    await releaseLlmStepCall(SQL, { lease: LEASE });
    expect(mocks.releaseDirectCall).toHaveBeenCalledWith(SQL, LEASE);
    expect(mocks.settleTokenCall).not.toHaveBeenCalled();
  });
});
