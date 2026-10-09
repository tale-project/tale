/**
 * An embedding request is a token-priced direct call: its estimated input
 * is held under whoever the work is for, and what the provider reported is
 * booked in the hold's place. The direct-call lease is a stand-in.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openTokenCall: vi.fn(),
  settleTokenCall: vi.fn(async () => 'settled'),
  releaseDirectCall: vi.fn(async () => undefined),
}));

vi.mock('../governance/direct-calls.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/direct-calls.ts')>()),
  openTokenCall: mocks.openTokenCall,
  settleTokenCall: mocks.settleTokenCall,
  releaseDirectCall: mocks.releaseDirectCall,
}));

const { EmbeddingBudgetExceeded } =
  await import('../../core/knowledge/embedding.ts');
const { deferredEmbeddingMeter, embeddingMeter, refusedEmbeddingCap } =
  await import('./embedding-meter.ts');

const SQL = {} as Sql;
const SUBJECT = {
  userId: 'user-1',
  agentSlug: '__embedding__',
  apiKeyId: 'key-1',
  projectIds: ['project-1'],
};
const LEASE = {
  organizationId: 'org-1',
  sessionId: 'direct-call:embedding',
  execId: 'e1',
  subject: SUBJECT,
};
const REQUEST = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  tokens: 1_200,
};
const CAP = {
  scope: 'project',
  projectId: 'project-1',
  code: 'COST_LIMIT',
  period: 'monthly',
  used: 100,
  limit: 100,
  reason: 'x',
  resetsAt: Date.UTC(2026, 10, 1),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openTokenCall.mockResolvedValue({ allowed: true, lease: LEASE });
});

describe('embeddingMeter [GOV-R5]', () => {
  it('holds a request’s estimated input under the subject, and books what was reported', async () => {
    const meter = embeddingMeter(SQL, {
      organizationId: 'org-1',
      subject: SUBJECT,
    });

    await expect(meter.open(REQUEST)).resolves.toEqual({ lease: LEASE });
    expect(mocks.openTokenCall).toHaveBeenCalledWith(SQL, {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'text-embedding-3-small',
      lane: 'embedding',
      subject: SUBJECT,
      promptTokens: 1_200,
      maxOutputTokens: 0,
      maxDurationMs: expect.any(Number),
    });

    await meter.settle(LEASE, { ...REQUEST, tokens: 1_100 });
    expect(mocks.settleTokenCall).toHaveBeenCalledWith(SQL, LEASE, {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'text-embedding-3-small',
      inputTokens: 1_100,
      outputTokens: 0,
    });
  });

  it('answers a refusal with its sentence, its reset and the cap [GOV-R4]', async () => {
    mocks.openTokenCall.mockResolvedValue({
      allowed: false,
      reason: 'Usage limit reached.',
      violation: CAP,
    });
    const meter = embeddingMeter(SQL, {
      organizationId: 'org-1',
      subject: SUBJECT,
    });

    const refusal = await meter.open(REQUEST);
    expect(refusal).toEqual({
      refused: 'Usage limit reached.',
      retryAtMs: CAP.resetsAt,
      detail: CAP,
    });
    if (!('refused' in refusal)) throw new Error('refused');
    expect(
      refusedEmbeddingCap(
        new EmbeddingBudgetExceeded(
          refusal.refused,
          refusal.retryAtMs,
          refusal.detail,
        ),
      ),
    ).toEqual(CAP);
  });

  it('reads no cap off a refusal that carries none, and leaves foreign leases alone', async () => {
    expect(
      refusedEmbeddingCap(new EmbeddingBudgetExceeded('Usage limit reached.')),
    ).toBeNull();
    expect(
      refusedEmbeddingCap(
        new EmbeddingBudgetExceeded('x', undefined, { ...CAP, scope: 'moon' }),
      ),
    ).toBeNull();
    const meter = embeddingMeter(SQL, {
      organizationId: 'org-1',
      subject: SUBJECT,
    });
    await meter.settle('not-a-lease', REQUEST);
    await meter.release('not-a-lease');
    expect(mocks.settleTokenCall).not.toHaveBeenCalled();
    expect(mocks.releaseDirectCall).not.toHaveBeenCalled();
  });
});

describe('deferredEmbeddingMeter', () => {
  it('reads whose spend it is once, on the first request', async () => {
    const subject = vi.fn(async () => SUBJECT);
    const meter = deferredEmbeddingMeter(SQL, {
      organizationId: 'org-1',
      subject,
    });
    expect(subject).not.toHaveBeenCalled();

    await meter.open(REQUEST);
    await meter.open(REQUEST);
    await meter.release(LEASE);

    expect(subject).toHaveBeenCalledTimes(1);
    expect(mocks.openTokenCall).toHaveBeenCalledWith(
      SQL,
      expect.objectContaining({ subject: SUBJECT }),
    );
    expect(mocks.releaseDirectCall).toHaveBeenCalledWith(SQL, LEASE);
  });
});
