/**
 * The organization's input guardrails on a model-endpoint request: the chat
 * turn's own chain (the real filters, built from policy files the governance
 * seam answers here), applied to the system and user text — a block refuses,
 * a mask rewrites in place, a tokenizing PII policy is refused outright, a
 * fail-closed failure refuses, and a text judged once is not judged (or
 * logged) again.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TextSegment } from './wire.ts';
import { ModelApiRefusal } from './wire.ts';

const seam = vi.hoisted(() => ({
  policies: {} as Record<string, unknown>,
  moderated: [] as string[],
  moderationRun: null as unknown,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock('../governance/shim.ts', () => ({
  governanceShimHandlers: () => ({
    'governance/internal_queries:getPolicyConfigInternal': async (raw: {
      policyType: string;
    }) => seam.policies[raw.policyType] ?? null,
    'governance/internal_actions:runModerationProvider': async (raw: {
      text: string;
    }) => {
      seam.moderated.push(raw.text);
      return (
        seam.moderationRun ?? {
          outcome: { kind: 'pass' },
          extras: { httpStatus: 200, durationMs: 5, attempts: 1 },
        }
      );
    },
    'governance/internal_mutations:recordChatFilterEvent': async (
      raw: Record<string, unknown>,
    ) => {
      seam.events.push(raw);
      return null;
    },
  }),
}));

const {
  buildModelApiGuardrails,
  piecesForScan,
  resetGuardrailVerdictsForTests,
} = await import('./guardrails.ts');

const sql = {} as never;

const CHAT_FILTER_BLOCK = {
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

function segment(role: TextSegment['role'], initial: string) {
  const state = { text: initial };
  const value: TextSegment = {
    role,
    read: () => state.text,
    write: (text) => {
      state.text = text;
    },
  };
  return { segment: value, state };
}

async function refusalOf(promise: Promise<unknown>): Promise<ModelApiRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ModelApiRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  seam.policies = {};
  seam.moderated = [];
  seam.moderationRun = null;
  seam.events = [];
  resetGuardrailVerdictsForTests();
});

describe('buildModelApiGuardrails', () => {
  it('lets everything through when no input guardrail is configured', async () => {
    const guardrails = await buildModelApiGuardrails(sql, {
      organizationId: 'org-1',
      requestId: 'req-1',
    });
    const text = segment('user', 'bluebird at a@b.example');
    await guardrails.apply([text.segment]);
    expect(text.state.text).toBe('bluebird at a@b.example');
  });

  it('refuses a request the chat filter blocks, naming the filter, and logs the event under the request', async () => {
    seam.policies = { chat_filter: CHAT_FILTER_BLOCK };
    const guardrails = await buildModelApiGuardrails(sql, {
      organizationId: 'org-1',
      requestId: 'req-1',
    });
    const refused = await refusalOf(
      guardrails.apply([
        segment('system', 'be kind').segment,
        segment('user', 'the bluebird plan').segment,
      ]),
    );
    expect(refused.status).toBe(400);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_BLOCKED');
    expect(refused.message).toContain('chat_filter');
    expect(refused.message).toContain('codenames');
    expect(seam.events).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        threadId: 'model-api:req-1',
        agentSlug: '__direct_api__',
        filterName: 'chat_filter',
        kind: 'blocked',
        direction: 'input',
      }),
    ]);
  });

  it('masks personal data in place, so the relayed body carries the mask', async () => {
    seam.policies = { pii_config: PII_MASK };
    const guardrails = await buildModelApiGuardrails(sql, {
      organizationId: 'org-1',
      requestId: 'req-2',
    });
    const text = segment('user', 'mail me at jane.doe@example.com please');
    await guardrails.apply([text.segment]);
    expect(text.state.text).not.toContain('jane.doe@example.com');
    expect(text.state.text).toMatch(/^mail me at .+ please$/);
  });

  it('refuses a tokenizing PII policy it cannot honour', async () => {
    seam.policies = {
      pii_config: {
        enabled: true,
        mode: 'tokenize',
        enabledPatterns: ['email'],
      },
    };
    const refused = await refusalOf(
      buildModelApiGuardrails(sql, { organizationId: 'org-1', requestId: 'r' }),
    );
    expect(refused.status).toBe(403);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_UNSUPPORTED');
  });

  it('refuses when the moderation provider fails under a fail-closed policy', async () => {
    seam.policies = { moderation_provider: MODERATION };
    seam.moderationRun = {
      outcome: {
        kind: 'step_error',
        filterName: 'moderation_provider',
        reason: 'timeout',
      },
      extras: { errorClass: 'timeout', attempts: 2 },
    };
    const guardrails = await buildModelApiGuardrails(sql, {
      organizationId: 'org-1',
      requestId: 'r',
    });
    const refused = await refusalOf(
      guardrails.apply([segment('user', 'hello').segment]),
    );
    expect(refused.status).toBe(503);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_UNAVAILABLE');
  });

  it('judges a resent text once: the moderation round and the detection are not repeated', async () => {
    seam.policies = { pii_config: PII_MASK, moderation_provider: MODERATION };
    const first = await buildModelApiGuardrails(sql, {
      organizationId: 'org-1',
      requestId: 'r1',
    });
    const system = segment('system', 'You are a coding agent.');
    const message = segment('user', 'reach me at jane.doe@example.com');
    await first.apply([system.segment, message.segment]);
    expect(seam.moderated).toHaveLength(2);
    const detections = seam.events.length;
    expect(detections).toBeGreaterThan(0);

    // The next request resends the conversation plus one new message.
    const second = await buildModelApiGuardrails(sql, {
      organizationId: 'org-1',
      requestId: 'r2',
    });
    const again = segment('user', 'reach me at jane.doe@example.com');
    const fresh = segment('user', 'now fix it');
    await second.apply([
      segment('system', 'You are a coding agent.').segment,
      again.segment,
      fresh.segment,
    ]);
    // The remembered mask is applied, only the new text went out.
    expect(again.state.text).toBe(message.state.text);
    expect(seam.moderated).toEqual([
      'You are a coding agent.',
      expect.any(String),
      'now fix it',
    ]);
    expect(seam.events).toHaveLength(detections);
  });

  it('judges again once the policy changes', async () => {
    seam.policies = { moderation_provider: MODERATION };
    await (
      await buildModelApiGuardrails(sql, {
        organizationId: 'org-1',
        requestId: 'a',
      })
    ).apply([segment('user', 'same text').segment]);
    seam.policies = {
      moderation_provider: { ...MODERATION, appliesTo: ['input', 'output'] },
    };
    await (
      await buildModelApiGuardrails(sql, {
        organizationId: 'org-1',
        requestId: 'b',
      })
    ).apply([segment('user', 'same text').segment]);
    expect(seam.moderated).toEqual(['same text', 'same text']);
  });
});

describe('piecesForScan', () => {
  it('keeps a text within the scan limit whole', () => {
    expect(piecesForScan('short', 100)).toEqual(['short']);
  });

  it('cuts a longer text at line breaks, never losing a character', () => {
    const text = `${'a'.repeat(40)}\n${'b'.repeat(40)}\n${'c'.repeat(40)}`;
    const pieces = piecesForScan(text, 90);
    expect(pieces.join('')).toBe(text);
    expect(pieces[0]).toBe(`${'a'.repeat(40)}\n${'b'.repeat(40)}\n`);
    for (const piece of pieces) {
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(90);
    }
  });

  it('counts bytes, not code units, and never splits a character', () => {
    const text = '€'.repeat(50);
    const pieces = piecesForScan(text, 31);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) {
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(31);
    }
    const astral = '😀'.repeat(20);
    expect(piecesForScan(astral, 10).join('')).toBe(astral);
  });
});
