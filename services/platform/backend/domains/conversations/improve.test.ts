import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyReplyError } from '../../core/automations_builder/chat_wire';

const mocks = vi.hoisted(() => ({
  resolveDirectModel: vi.fn(),
  modelCall: vi.fn(),
  openTokenCall: vi.fn(),
  settleTokenCall: vi.fn(async () => 'settled'),
  releaseDirectCall: vi.fn(async () => undefined),
}));

vi.mock('../../core/chat/generate_title', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/chat/generate_title')>()),
  resolveDirectModel: mocks.resolveDirectModel,
}));
vi.mock('../../core/automations_builder/model_call', () => ({
  createBuilderModel: () => mocks.modelCall,
}));
vi.mock('../../lib/ctx-shim.ts', () => ({
  createCtxShim: () => ({ runQuery: async () => null }),
}));
vi.mock('../governance/direct-calls.ts', () => ({
  openTokenCall: mocks.openTokenCall,
  settleTokenCall: mocks.settleTokenCall,
  releaseDirectCall: mocks.releaseDirectCall,
}));

const {
  buildImprovePrompt,
  IMPROVE_MAX_INPUT_CHARS,
  improveConversationMessage,
} = await import('./improve.ts');

// The composer's Improve with AI used to answer, client-side, "Message
// improvement is offline while the platform AI backend is rewritten" — an
// entry a person could enter and submit but never complete (CONV-F8). The
// lane is one bounded direct call; its prompt is what this locks.
describe('buildImprovePrompt', () => {
  it('sends the rules, then the draft, with the instruction ahead of it', () => {
    const messages = buildImprovePrompt({
      originalMessage: 'Hi,\n\nthanks for writing.',
      instruction: 'make it warmer',
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[0]?.content).toContain('Keep every fact');
    expect(messages[1]?.content).toBe(
      'Instruction: make it warmer\n\nDraft:\n\nHi,\n\nthanks for writing.',
    );
  });

  it('omits the instruction line when none was given', () => {
    expect(buildImprovePrompt({ originalMessage: 'x' })[1]?.content).toBe(
      'Draft:\n\nx',
    );
    expect(
      buildImprovePrompt({ originalMessage: 'x', instruction: '   ' })[1]
        ?.content,
    ).toBe('Draft:\n\nx');
  });

  it('bounds the draft it forwards', () => {
    const content = buildImprovePrompt({
      originalMessage: 'y'.repeat(IMPROVE_MAX_INPUT_CHARS + 500),
    })[1]?.content;
    expect(content?.length).toBe('Draft:\n\n'.length + IMPROVE_MAX_INPUT_CHARS);
  });
});

describe('improveConversationMessage and the writer’s limits', () => {
  const SQL = {} as Sql;
  const LEASE = { sessionId: 'direct-call:improve', execId: 'e1' };
  const ARGS = {
    organizationId: 'org-1',
    userId: 'user-1',
    originalMessage: 'Hi, thanks for writing.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDirectModel.mockResolvedValue({
      target: { providerSlug: 'openai', modelId: 'gpt-5-mini' },
    });
    mocks.openTokenCall.mockResolvedValue({ allowed: true, lease: LEASE });
    mocks.modelCall.mockResolvedValue({
      content: 'Hello, and thank you for writing.',
      usage: { prompt: 300, completion: 12 },
    });
  });

  it('picks only a model the writer may use, and books the rewrite in its hold’s place [GOV-R8]', async () => {
    await expect(improveConversationMessage(SQL, ARGS)).resolves.toEqual({
      improvedMessage: 'Hello, and thank you for writing.',
    });
    expect(mocks.resolveDirectModel).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      null,
      'user-1',
    );
    expect(mocks.openTokenCall).toHaveBeenCalledWith(SQL, {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'gpt-5-mini',
      lane: 'improve',
      subject: { userId: 'user-1', agentSlug: 'inbox-improve' },
      promptTokens: expect.any(Number),
      maxOutputTokens: 1_500,
      maxDurationMs: expect.any(Number),
    });
    expect(mocks.settleTokenCall).toHaveBeenCalledWith(SQL, LEASE, {
      organizationId: 'org-1',
      provider: 'openai',
      model: 'gpt-5-mini',
      inputTokens: 300,
      outputTokens: 12,
    });
  });

  it('tells a writer the model access rules close every model apart from an organization with no provider [GOV-R8]', async () => {
    mocks.resolveDirectModel.mockResolvedValueOnce({ missing: 'model-access' });
    await expect(improveConversationMessage(SQL, ARGS)).rejects.toMatchObject({
      code: 'IMPROVE_NO_MODEL_ACCESS',
      status: 403,
    });
    mocks.resolveDirectModel.mockResolvedValueOnce({ missing: 'provider' });
    await expect(improveConversationMessage(SQL, ARGS)).rejects.toMatchObject({
      code: 'IMPROVE_UNAVAILABLE',
      status: 409,
    });
    expect(mocks.openTokenCall).not.toHaveBeenCalled();
  });

  it('refuses with 429 BUDGET_EXCEEDED before the provider once a limit has no room [GOV-R4]', async () => {
    mocks.openTokenCall.mockResolvedValue({
      allowed: false,
      reason:
        'Usage limit reached. Your monthly cost limit is used up until 2026-11-01T00:00:00.000Z.',
    });
    await expect(improveConversationMessage(SQL, ARGS)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      status: 429,
      message: expect.stringContaining('Your monthly cost limit is used up'),
    });
    expect(mocks.modelCall).not.toHaveBeenCalled();
  });

  it('releases the hold of a call that failed without usage, and books an empty reply', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.modelCall.mockRejectedValueOnce(new Error('provider 500'));
    await expect(improveConversationMessage(SQL, ARGS)).rejects.toMatchObject({
      code: 'IMPROVE_FAILED',
    });
    expect(mocks.releaseDirectCall).toHaveBeenCalledWith(SQL, LEASE);
    expect(mocks.settleTokenCall).not.toHaveBeenCalled();

    mocks.modelCall.mockRejectedValueOnce(
      new EmptyReplyError({ prompt: 300, completion: 1_500 }),
    );
    await expect(improveConversationMessage(SQL, ARGS)).rejects.toMatchObject({
      code: 'IMPROVE_FAILED',
    });
    expect(mocks.settleTokenCall).toHaveBeenCalledWith(
      SQL,
      LEASE,
      expect.objectContaining({ inputTokens: 300, outputTokens: 1_500 }),
    );
  });
});
