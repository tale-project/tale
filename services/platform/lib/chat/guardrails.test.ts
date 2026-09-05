import { describe, expect, it, vi } from 'vitest';

import type { FilterName, FilterOutcome } from '../pii/core/outcome';
import { PatternRegistry } from '../pii/engine/registry';
import { createScrubber } from '../pii/engine/scrubber';
import { createTokenizer } from '../pii/engine/tokenizer';
import { chatFilterConfigSchema } from '../shared/schemas/governance';
import {
  createChatFilter,
  createModerationFilter,
  createOutputTransform,
  createPiiFilter,
  createPiiTokenizeFilter,
  GUARDRAIL_CHAIN_ORDER,
  runGuardrailChain,
  type GuardrailFilter,
} from './guardrails';

/**
 * The chain's whole job is ORDER and SHORT-CIRCUITING: the cheap local filter
 * first, PII before anything leaves the process, moderation last, and nothing
 * after a refusal. These tests hand it filters in the wrong order on purpose,
 * because the caller's order must not be able to change the chain's.
 *
 * Nothing here touches the network — the moderation step is a port, and the
 * assertions that matter most are the ones proving it was never called.
 */

function recordingFilter(
  name: FilterName,
  log: FilterName[],
  outcome: FilterOutcome = { kind: 'pass' },
): GuardrailFilter {
  return {
    name,
    run() {
      log.push(name);
      return outcome;
    },
  };
}

describe('runGuardrailChain', () => {
  it('runs chat_filter, then pii, then moderation — whatever order it is given', async () => {
    const log: FilterName[] = [];
    const result = await runGuardrailChain('hello', 'input', [
      recordingFilter('moderation_provider', log),
      recordingFilter('pii', log),
      recordingFilter('chat_filter', log),
    ]);

    expect(log).toEqual(['chat_filter', 'pii', 'moderation_provider']);
    expect(result.ran).toEqual(GUARDRAIL_CHAIN_ORDER);
    expect(result.refusal).toBeUndefined();
  });

  it('reports every non-pass outcome to the observer, the blocking one included', async () => {
    const seen: Array<{ filterName: FilterName; kind: string }> = [];
    const masking: GuardrailFilter = {
      name: 'chat_filter',
      run: () => ({
        kind: 'modified',
        text: 'masked',
        categoryIds: ['codenames'],
        matchCount: 1,
      }),
    };
    const blocking: GuardrailFilter = {
      name: 'pii',
      run: () => ({ kind: 'blocked', categoryIds: ['iban'], matchCount: 2 }),
    };
    const result = await runGuardrailChain(
      'hello',
      'output',
      [blocking, masking, recordingFilter('moderation_provider', [])],
      {
        onOutcome: (event) => {
          expect(event.direction).toBe('output');
          seen.push({ filterName: event.filterName, kind: event.outcome.kind });
        },
      },
    );

    // The pass from the third step is not an event, and nothing after the
    // block ran to produce one.
    expect(seen).toEqual([
      { filterName: 'chat_filter', kind: 'modified' },
      { filterName: 'pii', kind: 'blocked' },
    ]);
    expect(result.refusal?.filterName).toBe('pii');
  });

  it('keeps the verdict when the observer itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocking: GuardrailFilter = {
      name: 'chat_filter',
      run: () => ({ kind: 'blocked', categoryIds: ['x'], matchCount: 1 }),
    };
    const result = await runGuardrailChain('hello', 'input', [blocking], {
      onOutcome: () => Promise.reject(new Error('events table is away')),
    });
    warn.mockRestore();

    expect(result.refusal?.filterName).toBe('chat_filter');
  });

  it('skips a filter the org has not configured', async () => {
    const log: FilterName[] = [];
    const result = await runGuardrailChain('hello', 'input', [
      recordingFilter('pii', log),
    ]);

    expect(log).toEqual(['pii']);
    expect(result.ran).toEqual(['pii']);
  });

  it('short-circuits on a refusal — nothing after the blocking filter runs', async () => {
    const log: FilterName[] = [];
    const moderation = vi.fn();
    const result = await runGuardrailChain('secret', 'input', [
      recordingFilter('chat_filter', log, {
        kind: 'blocked',
        categoryIds: ['banned'],
        matchCount: 1,
      }),
      recordingFilter('pii', log),
      { name: 'moderation_provider', run: moderation },
    ]);

    expect(log).toEqual(['chat_filter']);
    expect(moderation).not.toHaveBeenCalled();
    expect(result.ran).toEqual(['chat_filter']);
    expect(result.refusal).toEqual({
      filterName: 'chat_filter',
      categoryIds: ['banned'],
      matchCount: 1,
    });
  });

  it('feeds each filter the text the previous one rewrote', async () => {
    const seen: string[] = [];
    const result = await runGuardrailChain('my card is 1234', 'input', [
      {
        name: 'chat_filter',
        run(text) {
          seen.push(text);
          return {
            kind: 'modified',
            text: text.replace('1234', '[MASKED]'),
            categoryIds: ['numbers'],
            matchCount: 1,
          };
        },
      },
      {
        name: 'moderation_provider',
        run(text) {
          seen.push(text);
          return { kind: 'pass' };
        },
      },
    ]);

    expect(seen).toEqual(['my card is 1234', 'my card is [MASKED]']);
    expect(result.text).toBe('my card is [MASKED]');
    expect(result.flaggedCategoryIds).toEqual(['numbers']);
  });

  it('fails open on input and closed on output when a filter itself breaks', async () => {
    const broken: GuardrailFilter = {
      name: 'moderation_provider',
      run() {
        return {
          kind: 'step_error',
          filterName: 'moderation_provider',
          reason: 'timeout',
        };
      },
    };

    const onInput = await runGuardrailChain('hi', 'input', [broken]);
    expect(onInput.refusal).toBeUndefined();

    const onOutput = await runGuardrailChain('hi', 'output', [broken]);
    expect(onOutput.refusal?.stepError).toBe('timeout');
  });

  it('refuses two filters claiming the same chain step', async () => {
    const log: FilterName[] = [];
    await expect(
      runGuardrailChain('hi', 'input', [
        recordingFilter('pii', log),
        recordingFilter('pii', log),
      ]),
    ).rejects.toThrow(/two filters claim the name "pii"/);
  });
});

describe('createChatFilter', () => {
  const config = (
    overrides: Partial<Record<string, unknown>> = {},
  ): ReturnType<typeof chatFilterConfigSchema.parse> =>
    chatFilterConfigSchema.parse({
      enabled: true,
      categories: [
        {
          id: 'banned',
          label: 'Banned words',
          enabled: true,
          mode: 'block',
          words: ['classified'],
          patterns: [],
        },
      ],
      ...overrides,
    });

  it('is absent when the policy is off', () => {
    expect(
      createChatFilter(
        chatFilterConfigSchema.parse({ enabled: false, categories: [] }),
      ),
    ).toBeNull();
  });

  it('blocks on a banned word and reports the category, not the text', () => {
    const filter = createChatFilter(config());
    const outcome = filter?.run('this is classified material', 'input');
    expect(outcome).toMatchObject({ kind: 'blocked', categoryIds: ['banned'] });
    expect(JSON.stringify(outcome)).not.toContain('classified material');
  });

  it('matches whole words only', () => {
    const filter = createChatFilter(config());
    expect(filter?.run('declassified documents', 'input')).toEqual({
      kind: 'pass',
    });
  });

  it('masks instead of blocking when the category says so', () => {
    const filter = createChatFilter(
      config({
        maskReplacement: '[BLOCKED]',
        categories: [
          {
            id: 'codenames',
            label: 'Codenames',
            enabled: true,
            mode: 'mask',
            words: ['bluebird'],
            patterns: [],
          },
        ],
      }),
    );
    expect(filter?.run('project bluebird ships friday', 'input')).toMatchObject(
      {
        kind: 'modified',
        text: 'project [BLOCKED] ships friday',
      },
    );
  });

  it('flags without touching the text', () => {
    const filter = createChatFilter(
      config({
        categories: [
          {
            id: 'watch',
            label: 'Watchlist',
            enabled: true,
            mode: 'flag',
            words: [],
            patterns: [{ name: 'ticket', regex: 'TCK-[0-9]{4}' }],
          },
        ],
      }),
    );
    expect(filter?.run('see TCK-1234', 'input')).toMatchObject({
      kind: 'flagged',
      categoryIds: ['watch'],
      matchCount: 1,
    });
  });

  it('lets a direction the policy does not cover through untouched', () => {
    const filter = createChatFilter(config({ appliesTo: ['input'] }));
    expect(filter?.run('this is classified', 'output')).toEqual({
      kind: 'pass',
    });
  });
});

describe('createPiiFilter', () => {
  it('delegates to the pii library rather than detecting anything itself', () => {
    // A real scrubber from `lib/pii`, built with only a custom pattern so the
    // test needs no shipped data tree.
    const scrubber = createScrubber({
      mode: 'mask',
      patterns: {},
      customPatterns: [
        { name: 'employeeId', regex: 'EMP-[0-9]{4}', replacement: '[EMP]' },
      ],
      registry: PatternRegistry.empty(),
    });
    const filter = createPiiFilter(scrubber);

    expect(filter?.name).toBe('pii');
    expect(filter?.run('badge EMP-4711 please', 'input')).toMatchObject({
      kind: 'modified',
      text: 'badge [EMP] please',
    });
  });

  it('is absent when the org has PII scrubbing switched off', () => {
    expect(createPiiFilter(null)).toBeNull();
  });
});

describe('createPiiTokenizeFilter', () => {
  const tokenizer = createTokenizer({
    mode: 'tokenize',
    patterns: { email: true },
    registry: PatternRegistry.fromDefaults(),
  });

  it('tokenizes on the way in and restores the same tokens on the way out', async () => {
    const filter = createPiiTokenizeFilter(tokenizer);
    if (filter === null) throw new Error('filter expected');

    const inbound = await filter.run('mail anna@example.com today', 'input');
    expect(inbound).toMatchObject({
      kind: 'modified',
      text: 'mail [EMAIL_1] today',
      categoryIds: ['email'],
      matchCount: 1,
    });

    // The model echoes the token; the reader gets the address back — as a
    // rewrite that DETECTED nothing, so a host logging detections skips it.
    const outbound = await filter.run('Sent to [EMAIL_1].', 'output');
    expect(outbound).toEqual({
      kind: 'modified',
      text: 'Sent to anna@example.com.',
      categoryIds: [],
      matchCount: 0,
      truncated: undefined,
    });
  });

  it('passes output through untouched when nothing was tokenized', () => {
    const filter = createPiiTokenizeFilter(tokenizer);
    expect(filter?.run('plain reply', 'output')).toEqual({ kind: 'pass' });
  });

  it('is absent when the org has PII scrubbing switched off', () => {
    expect(createPiiTokenizeFilter(null)).toBeNull();
  });
});

describe('createModerationFilter', () => {
  it('turns a provider failure into a step error rather than throwing', async () => {
    const filter = createModerationFilter({
      moderate: () => Promise.reject(new TypeError('network down')),
    });
    await expect(filter?.run('hi', 'input')).resolves.toMatchObject({
      kind: 'step_error',
      filterName: 'moderation_provider',
    });
  });
});

describe('createOutputTransform', () => {
  it('buffers until a segment is worth checking, then clears it', async () => {
    const seen: string[] = [];
    const transform = createOutputTransform(
      [
        {
          name: 'chat_filter',
          run(text) {
            seen.push(text);
            return { kind: 'pass' };
          },
        },
      ],
      { minFlushChars: 10 },
    );

    expect(await transform.push('short')).toEqual({ text: '' });
    expect(seen).toEqual([]);

    const cleared = await transform.push('er than ten');
    expect(cleared.text).toBe('shorter than ten');
    expect(seen).toEqual(['shorter than ten']);
  });

  it('rewrites mid-stream and never emits the unfiltered segment', async () => {
    const transform = createOutputTransform(
      [
        {
          name: 'pii',
          run(text) {
            return {
              kind: 'modified',
              text: text.replace('a@b.com', '[EMAIL]'),
              categoryIds: ['email'],
              matchCount: 1,
            };
          },
        },
      ],
      { minFlushChars: 1 },
    );

    const chunk = await transform.push('write to a@b.com');
    expect(chunk.text).toBe('write to [EMAIL]');
  });

  it('stops the stream on a refusal and stays stopped', async () => {
    const transform = createOutputTransform(
      [
        {
          name: 'moderation_provider',
          run() {
            return {
              kind: 'blocked',
              categoryIds: ['self-harm'],
              matchCount: 1,
            };
          },
        },
      ],
      { minFlushChars: 1 },
    );

    const refused = await transform.push('anything');
    expect(refused.text).toBe('');
    expect(refused.refusal?.filterName).toBe('moderation_provider');

    expect(await transform.push('more')).toEqual({ text: '' });
    expect(await transform.flush()).toEqual({ text: '' });
  });

  it('emits immediately when no filters are attached', async () => {
    const transform = createOutputTransform([]);
    const short = 'x'.repeat(40);
    expect(await transform.push(short)).toEqual({ text: short });
  });

  it('still buffers until minFlushChars when a filter is attached', async () => {
    const transform = createOutputTransform([recordingFilter('pii', [])]);
    const short = 'x'.repeat(40);
    expect(await transform.push(short)).toEqual({ text: '' });
    expect(await transform.flush()).toEqual({ text: short });
  });

  it('checks the tail on flush when a filter is buffering', async () => {
    const transform = createOutputTransform([recordingFilter('pii', [])], {
      minFlushChars: 1000,
    });
    expect(await transform.push('tail')).toEqual({ text: '' });
    expect(await transform.flush()).toEqual({ text: 'tail' });
  });
});
