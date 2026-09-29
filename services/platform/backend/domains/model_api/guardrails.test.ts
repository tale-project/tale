/**
 * The organization's input guardrails on a model-endpoint request: the chat
 * turn's own chain (the real filters, built from policy files read strictly
 * here), applied to every stretch of caller text — a block refuses, a mask
 * rewrites in place (or refuses on a name), a tokenizing PII policy is
 * refused outright, a fail-closed failure refuses, an unreadable policy shuts
 * the door, too much text is refused before anything runs, and a text judged
 * once is not judged (or logged) again. The texts still to judge share chain
 * runs, and the verdict memory is bounded by bytes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SegmentPlace, TextSegment, WireRequest } from './wire.ts';
import { ModelApiRefusal } from './wire.ts';

const seam = vi.hoisted(() => ({
  policies: {} as Record<string, unknown>,
  unreadable: new Set<string>(),
  brokenPii: false,
  moderated: [] as string[],
  moderationRun: null as unknown,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicy: async (
    _orgSlug: string,
    policyType: string,
    options: { strict?: boolean },
  ) => {
    if (options.strict !== true) throw new Error('read strictly, always');
    if (seam.unreadable.has(policyType)) {
      throw new Error(`${policyType} is corrupted`);
    }
    return seam.policies[policyType] ?? null;
  },
}));

vi.mock('../../../lib/pii', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/pii')>();
  return {
    ...actual,
    createScrubber: (...args: Parameters<typeof actual.createScrubber>) => {
      if (seam.brokenPii) throw new Error('the scrubber cannot be built');
      return actual.createScrubber(...args);
    },
  };
});

vi.mock('../governance/shim.ts', () => ({
  governanceShimHandlers: () => ({
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
  guardrailVerdictMemoryForTests,
  MAX_CHAIN_RUNS,
  MAX_SCANNED_TEXT_BYTES,
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

function segment(where: SegmentPlace, initial: string, maskable = true) {
  const state = { text: initial };
  const value: TextSegment = {
    where,
    maskable,
    read: () => state.text,
    write: (text) => {
      state.text = text;
    },
  };
  return { segment: value, state };
}

function request(
  segments: readonly TextSegment[],
  overrides: Partial<WireRequest> = {},
): WireRequest {
  return {
    body: {},
    model: 'm/x',
    stream: false,
    choiceCount: 1,
    imageCount: 0,
    documentCount: 0,
    mediaChars: 0,
    offersTools: false,
    segments: [...segments],
    textBytes: segments.reduce(
      (bytes, item) => bytes + Buffer.byteLength(item.read()),
      0,
    ),
    segmentOverflow: false,
    ...overrides,
  };
}

let paidCallChecks = 0;

function build(requestId: string, overrides: Record<string, unknown> = {}) {
  return buildModelApiGuardrails(sql, {
    organizationId: 'org-1',
    orgSlug: 'acme',
    requestId,
    callerRequestId: 'caller-7',
    beforePaidCall: async () => {
      paidCallChecks += 1;
    },
    ...overrides,
  });
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
  seam.unreadable = new Set();
  seam.brokenPii = false;
  seam.moderated = [];
  seam.moderationRun = null;
  seam.events = [];
  paidCallChecks = 0;
  resetGuardrailVerdictsForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('buildModelApiGuardrails', () => {
  it('lets everything through when no input guardrail is configured', async () => {
    const guardrails = await build('req-1');
    const text = segment('message', 'bluebird at a@b.example');
    await guardrails.apply(request([text.segment]));
    expect(text.state.text).toBe('bluebird at a@b.example');
  });

  it('refuses a request the chat filter blocks, and logs the event under the server id with the caller id beside it', async () => {
    seam.policies = { chat_filter: CHAT_FILTER_BLOCK };
    const guardrails = await build('req-1');
    const refused = await refusalOf(
      guardrails.apply(
        request([
          segment('system prompt', 'be kind').segment,
          segment('message', 'the bluebird plan').segment,
        ]),
      ),
    );
    expect(refused.status).toBe(400);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_BLOCKED');
    expect(refused.message).toContain('chat_filter');
    expect(refused.message).toContain('codenames');
    expect(seam.events).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        threadId: 'model-api:req-1',
        requestId: 'caller-7',
        agentSlug: '__direct_api__',
        filterName: 'chat_filter',
        kind: 'blocked',
        direction: 'input',
      }),
    ]);
  });

  it.each<[SegmentPlace, string]>([
    ['assistant turn', 'the bluebird plan, as I said'],
    ['tool result', '{"file": "notes about bluebird"}'],
    ['tool definition', 'Looks up the bluebird roster.'],
    ['tool call', 'bluebird'],
    ['document', 'Bluebird briefing'],
    ['prediction', 'bluebird'],
  ])('judges text in a %s like any other', async (where, text) => {
    seam.policies = { chat_filter: CHAT_FILTER_BLOCK };
    const guardrails = await build('req-2');
    const refused = await refusalOf(
      guardrails.apply(request([segment(where, text).segment])),
    );
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_BLOCKED');
    expect(refused.message).toContain(where);
  });

  it('masks personal data in place, so the relayed body carries the mask', async () => {
    seam.policies = { pii_config: PII_MASK };
    const guardrails = await build('req-2');
    const text = segment('message', 'mail me at jane.doe@example.com please');
    const result = segment('tool result', 'owner: bob@example.org');
    await guardrails.apply(request([text.segment, result.segment]));
    expect(text.state.text).not.toContain('jane.doe@example.com');
    expect(text.state.text).toMatch(/^mail me at .+ please$/);
    expect(result.state.text).not.toContain('bob@example.org');
  });

  it('refuses a mask on a name, which cannot be rewritten', async () => {
    seam.policies = { pii_config: PII_MASK };
    const guardrails = await build('req-3');
    const name = segment('tool definition', 'mail_jane.doe@example.com', false);
    const refused = await refusalOf(guardrails.apply(request([name.segment])));
    expect(refused.status).toBe(400);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_BLOCKED');
    expect(refused.message).toContain('name');
    expect(name.state.text).toBe('mail_jane.doe@example.com');
  });

  it('refuses a tokenizing PII policy it cannot honour', async () => {
    seam.policies = {
      pii_config: {
        enabled: true,
        mode: 'tokenize',
        enabledPatterns: ['email'],
      },
    };
    const refused = await refusalOf(build('r'));
    expect(refused.status).toBe(403);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_UNSUPPORTED');
  });

  it.each(['chat_filter', 'pii_config', 'moderation_provider'])(
    'shuts the door when the %s policy exists but cannot be read',
    async (policyType) => {
      seam.unreadable = new Set([policyType]);
      const refused = await refusalOf(build('r'));
      expect(refused.status).toBe(503);
      expect(refused.code).toBe('MODEL_API_GUARDRAIL_UNAVAILABLE');
      expect(refused.headers['retry-after']).toBe('30');
    },
  );

  it('shuts the door when the PII policy is on but cannot be built', async () => {
    seam.policies = { pii_config: PII_MASK };
    seam.brokenPii = true;
    const refused = await refusalOf(build('r'));
    expect(refused.status).toBe(503);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_UNAVAILABLE');
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
    const guardrails = await build('r');
    const refused = await refusalOf(
      guardrails.apply(request([segment('message', 'hello').segment])),
    );
    expect(refused.status).toBe(503);
    expect(refused.code).toBe('MODEL_API_GUARDRAIL_UNAVAILABLE');
  });

  it('reads the budgets once before the first paid moderation call, and not at all without one', async () => {
    seam.policies = { chat_filter: CHAT_FILTER_BLOCK };
    await (await build('a')).apply(request([segment('message', 'hi').segment]));
    expect(paidCallChecks).toBe(0);

    seam.policies = { moderation_provider: MODERATION };
    await (
      await build('b')
    ).apply(
      request([
        segment('message', 'one').segment,
        segment('message', 'two').segment,
      ]),
    );
    expect(paidCallChecks).toBe(1);
  });

  it('refuses before any moderation call when the budget read refuses', async () => {
    seam.policies = { moderation_provider: MODERATION };
    const guardrails = await build('b', {
      beforePaidCall: async () => {
        throw new ModelApiRefusal(
          429,
          'BUDGET_EXCEEDED',
          'Usage limit reached.',
        );
      },
    });
    const refused = await refusalOf(
      guardrails.apply(request([segment('message', 'hello').segment])),
    );
    expect(refused.code).toBe('BUDGET_EXCEEDED');
    expect(seam.moderated).toEqual([]);
  });

  it('joins short texts into one chain run, and judges a resent text once', async () => {
    seam.policies = { pii_config: PII_MASK, moderation_provider: MODERATION };
    const first = await build('r1');
    const system = segment('system prompt', 'You are a coding agent.');
    const message = segment('message', 'reach me at jane.doe@example.com');
    await first.apply(request([system.segment, message.segment]));
    // One provider call for both texts, joined.
    expect(seam.moderated).toHaveLength(1);
    expect(seam.moderated[0]).toContain('You are a coding agent.');
    expect(message.state.text).not.toContain('jane.doe@example.com');
    const detections = seam.events.length;
    expect(detections).toBeGreaterThan(0);

    // The next request resends the conversation plus one new message.
    const second = await build('r2');
    const again = segment('message', 'reach me at jane.doe@example.com');
    const fresh = segment('message', 'now fix it');
    await second.apply(
      request([
        segment('system prompt', 'You are a coding agent.').segment,
        again.segment,
        fresh.segment,
      ]),
    );
    // The remembered mask is applied, only the new text went out.
    expect(again.state.text).toBe(message.state.text);
    expect(seam.moderated).toEqual([expect.any(String), 'now fix it']);
    expect(seam.events).toHaveLength(detections);
  });

  it('judges each text alone when a mask reaches across the join', async () => {
    seam.policies = { pii_config: PII_MASK };
    const guardrails = await build('r');
    const a = segment('message', 'first a@b.example');
    const b = segment('message', 'second c@d.example');
    await guardrails.apply(request([a.segment, b.segment]));
    expect(a.state.text).toMatch(/^first /);
    expect(a.state.text).not.toContain('a@b.example');
    expect(b.state.text).toMatch(/^second /);
    expect(b.state.text).not.toContain('c@d.example');
  });

  it('judges again once the policy changes', async () => {
    seam.policies = { moderation_provider: MODERATION };
    await (
      await build('a')
    ).apply(request([segment('message', 'same text').segment]));
    seam.policies = {
      moderation_provider: { ...MODERATION, appliesTo: ['input', 'output'] },
    };
    await (
      await build('b')
    ).apply(request([segment('message', 'same text').segment]));
    expect(seam.moderated).toEqual(['same text', 'same text']);
  });

  it('refuses a request with more text than it may carry, before any run', async () => {
    seam.policies = { moderation_provider: MODERATION };
    const guardrails = await build('big');
    const refused = await refusalOf(
      guardrails.apply(
        request([segment('message', 'hello').segment], {
          textBytes: MAX_SCANNED_TEXT_BYTES + 1,
        }),
      ),
    );
    expect(refused.status).toBe(413);
    expect(refused.code).toBe('MODEL_API_TEXT_TOO_LARGE');
    expect(seam.moderated).toEqual([]);

    const overflow = await refusalOf(
      guardrails.apply(
        request([segment('message', 'hello').segment], {
          segmentOverflow: true,
        }),
      ),
    );
    expect(overflow.code).toBe('MODEL_API_TEXT_TOO_LARGE');
  });

  it('bounds the chain runs one request may cost', async () => {
    seam.policies = { moderation_provider: MODERATION };
    const guardrails = await build('runs');
    // Texts past the scan limit each run alone, in pieces.
    const long = 'x'.repeat(60 * 1024);
    const segments = Array.from(
      { length: MAX_CHAIN_RUNS + 1 },
      (_, index) => segment('tool result', `${index} ${long}`).segment,
    );
    const refused = await refusalOf(guardrails.apply(request(segments)));
    expect(refused.status).toBe(413);
    expect(refused.code).toBe('MODEL_API_TEXT_TOO_LARGE');
    expect(seam.moderated).toEqual([]);
  });

  it('never remembers large masked texts, and bounds its memory by bytes', async () => {
    seam.policies = { pii_config: PII_MASK };
    const guardrails = await build('mem');
    const big = segment(
      'tool result',
      `${'word '.repeat(20_000)}jane.doe@example.com`,
    );
    await guardrails.apply(request([big.segment]));
    expect(big.state.text).not.toContain('jane.doe@example.com');
    // The masked text is over the size a verdict keeps: nothing remembered.
    expect(guardrailVerdictMemoryForTests().count).toBe(0);

    for (let index = 0; index < 50; index += 1) {
      await guardrails.apply(
        request([segment('message', `pass number ${index}`).segment]),
      );
    }
    const memory = guardrailVerdictMemoryForTests();
    expect(memory.count).toBe(50);
    // A pass keeps no text: its weight is the fixed overhead alone.
    expect(memory.bytes).toBe(50 * 160);
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

  it('falls back to the last space, then to the budget itself', () => {
    const spaced = `${'a'.repeat(30)} ${'b'.repeat(30)} ${'c'.repeat(30)}`;
    const pieces = piecesForScan(spaced, 70);
    expect(pieces.join('')).toBe(spaced);
    expect(pieces[0]).toBe(`${'a'.repeat(30)} ${'b'.repeat(30)} `);
    const solid = 'z'.repeat(250);
    const cut = piecesForScan(solid, 100);
    expect(cut).toEqual(['z'.repeat(100), 'z'.repeat(100), 'z'.repeat(50)]);
  });

  it('counts bytes, not code units, and never splits a character', () => {
    const text = '€'.repeat(50);
    const pieces = piecesForScan(text, 31);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) {
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(31);
    }
    const astral = '😀'.repeat(20);
    const astralPieces = piecesForScan(astral, 10);
    expect(astralPieces.join('')).toBe(astral);
    for (const piece of astralPieces) {
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(10);
    }
  });

  it('cuts a large text in one pass', () => {
    const line = `${'lorem ipsum '.repeat(20)}\n`;
    const text = line.repeat(40_000);
    const started = performance.now();
    const pieces = piecesForScan(text, 50 * 1024);
    const elapsed = performance.now() - started;
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) {
      expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(50 * 1024);
    }
    // Linear: ~10 MB is cut in well under a second.
    expect(elapsed).toBeLessThan(1_000);
  });
});
