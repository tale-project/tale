// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { runGuardrailChain } from '../../../lib/chat/guardrails';
import { shimFunctionName } from '../../lib/ctx-shim';
import type { ActionCtx } from '../lib/ctx';
import {
  buildTurnGuardrails,
  mandatoryInstructionsFor,
  readTurnPolicies,
} from './guardrails';

/**
 * The host's half of the guardrail contract: policy files become the chain
 * steps the pipeline runs, and every verdict lands in the event log. The ctx
 * is a fake answering the three seams by name — no Postgres, no provider.
 */

const ORG = 'org_1';
const THREAD = 'thread_1';

interface FakeCtx {
  ctx: ActionCtx;
  /** Every chat-filter event the host asked the seam to write. */
  events: Array<Record<string, unknown>>;
  /** Every moderation round the host asked the seam to run. */
  moderated: Array<{ direction: string; text: string }>;
}

function fakeCtx(
  policies: Record<string, unknown>,
  options: {
    moderationRun?: unknown;
    failEventWrite?: boolean;
  } = {},
): FakeCtx {
  const events: Array<Record<string, unknown>> = [];
  const moderated: Array<{ direction: string; text: string }> = [];
  const ctx = {
    runQuery: (ref: unknown, args: { policyType: string }) => {
      expect(shimFunctionName(ref)).toBe(
        'governance/internal_queries:getPolicyConfigInternal',
      );
      return Promise.resolve(policies[args.policyType] ?? null);
    },
    runMutation: (ref: unknown, args: Record<string, unknown>) => {
      expect(shimFunctionName(ref)).toBe(
        'governance/internal_mutations:recordChatFilterEvent',
      );
      if (options.failEventWrite === true) {
        return Promise.reject(new Error('events table is away'));
      }
      events.push(args);
      return Promise.resolve(null);
    },
    runAction: (ref: unknown, args: { direction: string; text: string }) => {
      expect(shimFunctionName(ref)).toBe(
        'governance/internal_actions:runModerationProvider',
      );
      moderated.push({ direction: args.direction, text: args.text });
      return Promise.resolve(
        options.moderationRun ?? {
          outcome: { kind: 'pass' },
          extras: { httpStatus: 200, durationMs: 12, attempts: 1 },
        },
      );
    },
  } as unknown as ActionCtx;
  return { ctx, events, moderated };
}

const CHAT_FILTER = {
  enabled: true,
  appliesTo: ['input'],
  categories: [
    {
      id: 'codenames',
      label: 'Codenames',
      enabled: true,
      mode: 'block',
      words: ['bluebird'],
      patterns: [],
    },
  ],
};

const PII_MASK = { enabled: true, mode: 'mask', enabledPatterns: ['email'] };
const PII_TOKENIZE = {
  enabled: true,
  mode: 'tokenize',
  enabledPatterns: ['email'],
};

const MODERATION = {
  enabled: true,
  appliesTo: ['input'],
  endpoint: {
    url: 'https://moderation.example.com/v1',
    headers: {},
    requestTemplate: '{"input": {{text}}}',
  },
  responseShape: { type: 'openai_moderation' },
  categoryMappings: [],
  failBehavior: { input: 'closed', output: 'open' },
};

async function chain(
  fake: FakeCtx,
  direction: 'input' | 'output',
  text: string,
) {
  const policies = await readTurnPolicies(fake.ctx, ORG);
  const deps = buildTurnGuardrails(fake.ctx, {
    organizationId: ORG,
    threadId: THREAD,
    agentSlug: 'assistant',
    policies,
  });
  const filters =
    direction === 'input' ? deps.inputFilters : deps.outputFilters;
  return runGuardrailChain(
    text,
    direction,
    filters ?? [],
    deps.guardrailOptions,
  );
}

describe('readTurnPolicies', () => {
  it('reads the four policy files through the seam, absent ones as null', async () => {
    const fake = fakeCtx({ chat_filter: CHAT_FILTER });
    const policies = await readTurnPolicies(fake.ctx, ORG);
    expect(policies.chatFilter?.categories[0]?.id).toBe('codenames');
    expect(policies.pii).toBeNull();
    expect(policies.moderation).toBeNull();
    expect(policies.systemPrompt).toBeNull();
  });

  it('drops a corrupt policy with a warning instead of failing the turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeCtx({ pii_config: { enabled: 'yes' } });
    const policies = await readTurnPolicies(fake.ctx, ORG);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unparseable pii_config'),
    );
    warn.mockRestore();
    expect(policies.pii).toBeNull();
  });
});

describe('mandatoryInstructionsFor', () => {
  it('yields the org text when the policy carries it', () => {
    expect(
      mandatoryInstructionsFor({
        chatFilter: null,
        pii: null,
        moderation: null,
        systemPrompt: { mandatoryInstructions: '  Never quote prices.  ' },
      }),
    ).toBe('Never quote prices.');
  });

  it('yields nothing when the policy is absent, disabled, or blank', () => {
    const base = { chatFilter: null, pii: null, moderation: null };
    expect(mandatoryInstructionsFor({ ...base, systemPrompt: null })).toBe(
      undefined,
    );
    expect(
      mandatoryInstructionsFor({
        ...base,
        systemPrompt: { enabled: false, mandatoryInstructions: 'Be terse.' },
      }),
    ).toBe(undefined);
    expect(
      mandatoryInstructionsFor({
        ...base,
        systemPrompt: { mandatoryInstructions: '   ' },
      }),
    ).toBe(undefined);
  });
});

describe('buildTurnGuardrails', () => {
  it('runs nothing and logs nothing for an org with no policies', async () => {
    const fake = fakeCtx({});
    const result = await chain(fake, 'input', 'anything goes');
    expect(result.ran).toEqual([]);
    expect(result.text).toBe('anything goes');
    expect(fake.events).toEqual([]);
  });

  it('blocks a banned word on input and writes the blocked event', async () => {
    const fake = fakeCtx({ chat_filter: CHAT_FILTER });
    const result = await chain(fake, 'input', 'project bluebird ships');
    expect(result.refusal).toMatchObject({
      filterName: 'chat_filter',
      categoryIds: ['codenames'],
    });
    expect(fake.events).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        threadId: THREAD,
        agentSlug: 'assistant',
        actorType: 'user',
        filterName: 'chat_filter',
        direction: 'input',
        kind: 'blocked',
        categoryIds: ['codenames'],
        matchCount: 1,
        sanitizationRunId: expect.any(String),
      }),
    ]);
  });

  it('honours the chat filter direction — an input-only policy leaves output alone', async () => {
    const fake = fakeCtx({ chat_filter: CHAT_FILTER });
    const result = await chain(fake, 'output', 'project bluebird ships');
    expect(result.refusal).toBeUndefined();
    expect(fake.events).toEqual([]);
  });

  it('masks PII the model would otherwise see and logs the detection', async () => {
    const fake = fakeCtx({ pii_config: PII_MASK });
    const result = await chain(fake, 'input', 'write to anna@example.com');
    expect(result.text).toBe('write to [EMAIL]');
    expect(fake.events).toEqual([
      expect.objectContaining({
        filterName: 'pii',
        kind: 'detected',
        categoryIds: ['email'],
      }),
    ]);
  });

  it('tokenizes on input, restores on output, and logs only the detection', async () => {
    const fake = fakeCtx({ pii_config: PII_TOKENIZE });
    const policies = await readTurnPolicies(fake.ctx, ORG);
    const deps = buildTurnGuardrails(fake.ctx, {
      organizationId: ORG,
      threadId: THREAD,
      policies,
    });
    const inbound = await runGuardrailChain(
      'write to anna@example.com',
      'input',
      deps.inputFilters ?? [],
      deps.guardrailOptions,
    );
    expect(inbound.text).toBe('write to [EMAIL_1]');
    const outbound = await runGuardrailChain(
      'Done — I wrote to [EMAIL_1].',
      'output',
      deps.outputFilters ?? [],
      deps.guardrailOptions,
    );
    expect(outbound.text).toBe('Done — I wrote to anna@example.com.');
    // One detection on the way in; the restore is not an event.
    expect(fake.events.map((event) => event.direction)).toEqual(['input']);
  });

  it('runs the provider only in its configured direction and records the round facts', async () => {
    const fake = fakeCtx(
      { moderation_provider: MODERATION },
      {
        moderationRun: {
          outcome: { kind: 'blocked', categoryIds: ['Hate'], matchCount: 1 },
          extras: { httpStatus: 200, durationMs: 40, attempts: 2 },
        },
      },
    );
    const outbound = await chain(fake, 'output', 'a reply');
    expect(fake.moderated).toEqual([]);
    expect(outbound.refusal).toBeUndefined();

    const inbound = await chain(fake, 'input', 'a message');
    expect(fake.moderated).toEqual([{ direction: 'input', text: 'a message' }]);
    expect(inbound.refusal?.filterName).toBe('moderation_provider');
    expect(fake.events).toEqual([
      expect.objectContaining({
        filterName: 'moderation_provider',
        kind: 'blocked',
        categoryIds: ['Hate'],
        httpStatus: 200,
        durationMs: 40,
        attempt: 2,
      }),
    ]);
  });

  it('applies the policy fail behaviour to a provider fault and logs the class', async () => {
    const fake = fakeCtx(
      { moderation_provider: MODERATION },
      {
        moderationRun: {
          outcome: {
            kind: 'step_error',
            filterName: 'moderation_provider',
            reason: 'timeout',
          },
          extras: { errorClass: 'timeout', attempts: 2 },
        },
      },
    );
    // input is fail-CLOSED in this policy: the fault refuses the message.
    const result = await chain(fake, 'input', 'a message');
    expect(result.refusal).toMatchObject({
      filterName: 'moderation_provider',
      stepError: 'timeout',
    });
    expect(fake.events).toEqual([
      expect.objectContaining({
        filterName: 'moderation_provider',
        kind: 'step_error',
        errorClass: 'timeout',
        attempt: 2,
      }),
    ]);
  });

  it('records an open circuit as its own event kind', async () => {
    const fake = fakeCtx(
      {
        moderation_provider: { ...MODERATION, failBehavior: { input: 'open' } },
      },
      {
        moderationRun: {
          outcome: {
            kind: 'step_error',
            filterName: 'moderation_provider',
            reason: 'unknown',
          },
          extras: { errorClass: 'unknown', circuitOpen: true },
        },
      },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await chain(fake, 'input', 'a message');
    warn.mockRestore();
    // fail-open: the message goes through, the outage is on record.
    expect(result.refusal).toBeUndefined();
    expect(fake.events[0]).toMatchObject({ kind: 'circuit_open' });
  });

  it('keeps the verdict when the event write fails', async () => {
    const fake = fakeCtx(
      { chat_filter: CHAT_FILTER },
      { failEventWrite: true },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await chain(fake, 'input', 'project bluebird ships');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('chat-filter event write failed'),
    );
    warn.mockRestore();
    expect(result.refusal?.filterName).toBe('chat_filter');
  });
});
