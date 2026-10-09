/**
 * The title job's meter holds the naming call as a token-priced direct call
 * under the subject the job names, answers a refusal as no lease, and books
 * or releases only a lease it issued. The direct-call helpers are stand-ins.
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

const { titleMeter } = await import('./title-meter.ts');

const SQL = {} as Sql;
const SUBJECT = {
  userId: 'user-1',
  agentSlug: 'thread-title',
  apiKeyId: 'key-1',
  projectIds: ['project-1'],
};
const LEASE = {
  organizationId: 'org-1',
  sessionId: 'direct-call:title',
  execId: 'e1',
  subject: SUBJECT,
};
const CALL = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  promptTokens: 120,
  maxOutputTokens: 48,
};

describe('titleMeter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('holds the naming call under the job’s subject, and books it in the hold’s place [GOV-R14]', async () => {
    mocks.openTokenCall.mockResolvedValue({ allowed: true, lease: LEASE });
    const meter = titleMeter(SQL, {
      organizationId: 'org-1',
      subject: SUBJECT,
    });

    await expect(meter.open(CALL)).resolves.toEqual({ lease: LEASE });
    expect(mocks.openTokenCall).toHaveBeenCalledWith(SQL, {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      lane: 'title',
      subject: SUBJECT,
      promptTokens: 120,
      maxOutputTokens: 48,
      maxDurationMs: expect.any(Number),
    });

    await meter.settle(LEASE, {
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 110,
      outputTokens: 5,
    });
    expect(mocks.settleTokenCall).toHaveBeenCalledWith(SQL, LEASE, {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 110,
      outputTokens: 5,
    });
  });

  it('answers a refusal with no lease, and leaves what it did not issue alone [GOV-R4]', async () => {
    mocks.openTokenCall.mockResolvedValue({ allowed: false, reason: 'x' });
    const meter = titleMeter(SQL, {
      organizationId: 'org-1',
      subject: SUBJECT,
    });

    await expect(meter.open(CALL)).resolves.toBeNull();
    await meter.settle('not-a-lease', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 1,
      outputTokens: 1,
    });
    await meter.release(undefined);
    expect(mocks.settleTokenCall).not.toHaveBeenCalled();
    expect(mocks.releaseDirectCall).not.toHaveBeenCalled();

    await meter.release(LEASE);
    expect(mocks.releaseDirectCall).toHaveBeenCalledWith(SQL, LEASE);
  });
});
