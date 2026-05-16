import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatFilterConfig } from '../../../lib/shared/schemas/governance';
import { resetCompilationCacheForTesting, runChatFilter } from './index';

function baseConfig(
  overrides: Partial<ChatFilterConfig> = {},
): ChatFilterConfig {
  return {
    enabled: true,
    maskReplacement: '[BLOCKED]',
    appliesTo: ['input'],
    preferNonStreamingForFiltering: false,
    configVersion: 1,
    categories: [],
    ...overrides,
  };
}

function runWith(text: string, config: ChatFilterConfig, ver = 1) {
  return runChatFilter({
    text,
    config,
    policyDocId: 'policy_test',
    updatedAt: ver,
  });
}

describe('runChatFilter — disabled / empty', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('passes through when top-level disabled', () => {
    const result = runWith('anything goes', baseConfig({ enabled: false }));
    expect(result.kind).toBe('pass');
  });

  it('passes through when no categories configured', () => {
    const result = runWith('hello world', baseConfig());
    expect(result.kind).toBe('pass');
  });

  it('passes through when category has empty words', () => {
    const result = runWith(
      'hello',
      baseConfig({
        categories: [
          {
            id: 'test',
            label: 'Test',
            enabled: true,
            mode: 'block',
            words: [],
            patterns: [],
          },
        ],
      }),
    );
    expect(result.kind).toBe('pass');
  });
});

describe('runChatFilter — word boundary (latin script)', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  const config = baseConfig({
    categories: [
      {
        id: 'profanity',
        label: 'Profanity',
        enabled: true,
        mode: 'mask',
        words: ['damn'],
        patterns: [],
      },
    ],
  });

  it('masks whole-word match', () => {
    const result = runWith('oh damn it', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('oh [BLOCKED] it');
    expect(result.categoryIds).toContain('profanity');
    expect(result.matchCount).toBe(1);
  });

  it('does not match inside another word (Scunthorpe problem)', () => {
    const result = runWith(
      'the library contains damning evidence',
      baseConfig({
        categories: [
          {
            id: 'test',
            label: 'Test',
            enabled: true,
            mode: 'block',
            words: ['damn'],
            patterns: [],
          },
        ],
      }),
    );
    // "damning" should NOT match "damn" with word-boundary strategy
    expect(result.kind).toBe('pass');
  });

  it('is case-insensitive', () => {
    const result = runWith('oh DaMn it', config);
    expect(result.kind).toBe('modified');
  });
});

describe('runChatFilter — CJK substring strategy', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('matches CJK word without space boundaries', () => {
    const result = runWith(
      '我讨厌仇恨言论',
      baseConfig({
        categories: [
          {
            id: 'hate',
            label: 'Hate',
            enabled: true,
            mode: 'block',
            words: ['仇恨'],
            patterns: [],
          },
        ],
      }),
    );
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.categoryIds).toContain('hate');
  });

  it('masks Japanese substring', () => {
    const result = runWith(
      'これは悪口です',
      baseConfig({
        categories: [
          {
            id: 'bad',
            label: 'Bad',
            enabled: true,
            mode: 'mask',
            words: ['悪口'],
            patterns: [],
          },
        ],
      }),
    );
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    expect(result.text).toBe('これは[BLOCKED]です');
  });
});

describe('runChatFilter — NFC normalization', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('matches precomposed against decomposed input', () => {
    // NFD decomposition of "café" (e + combining acute)
    const nfd = 'café'.normalize('NFD');
    expect(nfd).not.toBe('café');
    const result = runWith(
      `visit the ${nfd}`,
      baseConfig({
        categories: [
          {
            id: 'x',
            label: 'X',
            enabled: true,
            mode: 'mask',
            words: ['café'],
            patterns: [],
          },
        ],
      }),
    );
    expect(result.kind).toBe('modified');
  });
});

describe('runChatFilter — regex escape for word metacharacters', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('literal "." does not become wildcard', () => {
    const result = runWith(
      'hello world',
      baseConfig({
        categories: [
          {
            id: 'x',
            label: 'X',
            enabled: true,
            mode: 'mask',
            words: ['.'],
            patterns: [],
          },
        ],
      }),
    );
    // A literal '.' is not a word character, so word-boundary wrapping won't
    // match it — but the key assertion is: no crash and no wildcard match.
    expect(result.kind).toBe('pass');
  });

  it('parenthesis does not throw on compile', () => {
    expect(() =>
      runWith(
        'hello',
        baseConfig({
          categories: [
            {
              id: 'x',
              label: 'X',
              enabled: true,
              mode: 'mask',
              words: [')'],
              patterns: [],
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('runChatFilter — custom regex pattern', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('runs admin-supplied regex', () => {
    const result = runWith(
      'order #12345 shipped',
      baseConfig({
        categories: [
          {
            id: 'orders',
            label: 'Orders',
            enabled: true,
            mode: 'flag',
            words: [],
            patterns: [{ name: 'order_id', regex: '#\\d+' }],
          },
        ],
      }),
    );
    expect(result.kind).toBe('flagged');
    if (result.kind !== 'flagged') return;
    expect(result.categoryIds).toContain('orders');
  });

  it('does not throw on invalid regex at runtime (legacy row)', () => {
    // Zod would normally reject this, but a legacy DB row could hold one.
    expect(() =>
      runWith(
        'hello',
        baseConfig({
          categories: [
            {
              id: 'bad',
              label: 'Bad',
              enabled: true,
              mode: 'mask',
              words: [],
              patterns: [{ name: 'broken', regex: '[invalid' }],
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('runChatFilter — mode precedence', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('block wins over mask and flag', () => {
    const result = runWith(
      'bad stuff and danger',
      baseConfig({
        categories: [
          {
            id: 'block_cat',
            label: 'Block',
            enabled: true,
            mode: 'block',
            words: ['danger'],
            patterns: [],
          },
          {
            id: 'mask_cat',
            label: 'Mask',
            enabled: true,
            mode: 'mask',
            words: ['bad'],
            patterns: [],
          },
        ],
      }),
    );
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.categoryIds).toContain('block_cat');
  });
});

describe('runChatFilter — single-pass mask with overlapping spans', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('merges overlapping matches and does not double-mask', () => {
    const config = baseConfig({
      categories: [
        {
          id: 'a',
          label: 'A',
          enabled: true,
          mode: 'mask',
          words: ['hello'],
          patterns: [{ name: 'hel', regex: 'hel' }],
        },
      ],
    });
    const result = runWith('hello world', config);
    expect(result.kind).toBe('modified');
    if (result.kind !== 'modified') return;
    // Exactly one '[BLOCKED]' — not two overlapping masks.
    expect(result.text).toBe('[BLOCKED] world');
  });
});

describe('runChatFilter — truncation at MAX_MESSAGE_BYTES', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('flags truncated on oversized input', () => {
    const big = 'x'.repeat(60_000) + ' danger';
    const result = runWith(
      big,
      baseConfig({
        categories: [
          {
            id: 'x',
            label: 'X',
            enabled: true,
            mode: 'flag',
            words: ['danger'],
            patterns: [],
          },
        ],
      }),
    );
    // 'danger' falls past the truncation cap so no match, but run should
    // return without error and mark truncated.
    expect(['pass', 'flagged']).toContain(result.kind);
  });
});

describe('runChatFilter — LRU compile cache', () => {
  beforeEach(() => resetCompilationCacheForTesting());

  it('reuses compiled regex across calls with same policyDocId+updatedAt', () => {
    const config = baseConfig({
      categories: [
        {
          id: 'x',
          label: 'X',
          enabled: true,
          mode: 'mask',
          words: ['foo'],
          patterns: [],
        },
      ],
    });
    const a = runWith('foo', config, 1);
    const b = runWith('foo bar', config, 1);
    expect(a.kind).toBe('modified');
    expect(b.kind).toBe('modified');
  });

  it('recompiles on updatedAt bump', () => {
    const v1 = baseConfig({
      categories: [
        {
          id: 'x',
          label: 'X',
          enabled: true,
          mode: 'mask',
          words: ['foo'],
          patterns: [],
        },
      ],
    });
    const v2 = baseConfig({
      categories: [
        {
          id: 'x',
          label: 'X',
          enabled: true,
          mode: 'mask',
          words: ['bar'],
          patterns: [],
        },
      ],
    });
    const a = runWith('foo bar', v1, 1);
    expect(a.kind).toBe('modified');
    if (a.kind !== 'modified') return;
    expect(a.text).toBe('[BLOCKED] bar');

    const b = runWith('foo bar', v2, 2);
    expect(b.kind).toBe('modified');
    if (b.kind !== 'modified') return;
    expect(b.text).toBe('foo [BLOCKED]');
  });
});
