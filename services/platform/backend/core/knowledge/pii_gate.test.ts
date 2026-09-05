// The organization's PII policy, applied to text bound for the index.
//
// The engine itself is tested in `lib/pii`; what matters here is the mapping
// from a governance policy to an indexing decision, and that every failure
// degrades to today's behaviour rather than taking a corpus offline.

import { describe, expect, it, vi } from 'vitest';

import {
  applyPiiPolicyForIndexing,
  parsePiiConfig,
  scrubberForPolicy,
} from './pii_gate';

/** A policy with one obvious detector on, so a match is easy to arrange. */
function policy(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mode: 'mask',
    enabledPatterns: ['email', 'ssn'],
    ...overrides,
  } as never;
}

const WITH_PII = 'Contact me at ada@example.com about the role.';

describe('applyPiiPolicyForIndexing', () => {
  it('indexes unchanged and SILENTLY when there is no policy', () => {
    // Silence is the point. Most organizations have no policy, so reaching the
    // scrubber with a null config would throw and log a caught exception for
    // every file they index — the same decision, arrived at noisily.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(applyPiiPolicyForIndexing(WITH_PII, null)).toEqual({
      kind: 'index',
      text: WITH_PII,
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('indexes unchanged when the policy is disabled', () => {
    // An organization that has not turned this on gets exactly today's
    // behaviour — this must not become an opt-out.
    const decision = applyPiiPolicyForIndexing(
      WITH_PII,
      policy({ enabled: false }),
    );
    expect(decision).toEqual({ kind: 'index', text: WITH_PII });
  });

  it('masks under mode mask, so the identifier never reaches the vectors', () => {
    const decision = applyPiiPolicyForIndexing(WITH_PII, policy());
    expect(decision.kind).toBe('index');
    if (decision.kind !== 'index') return;
    expect(decision.text).not.toContain('ada@example.com');
    // The surrounding words survive, or the file stops being findable at all.
    expect(decision.text).toContain('about the role');
  });

  it('refuses under mode block, naming categories and not the matched text', () => {
    const decision = applyPiiPolicyForIndexing(
      WITH_PII,
      policy({ mode: 'block' }),
    );
    expect(decision.kind).toBe('refuse');
    if (decision.kind !== 'refuse') return;
    expect(decision.categoryIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(decision.categoryIds)).not.toContain('ada@');
  });

  it('treats tokenize as mask, because an indexed chunk outlives a restore map', () => {
    const decision = applyPiiPolicyForIndexing(
      WITH_PII,
      policy({ mode: 'tokenize' }),
    );
    expect(decision.kind).toBe('index');
    if (decision.kind !== 'index') return;
    expect(decision.text).not.toContain('ada@example.com');
  });

  // Documents past the engine's chat-sized clamp: PII near the top and at
  // the very end of a ~120 KB text, both far enough apart that a message-
  // sized scan would see only the first.
  const CARD = 'card 4111 1111 1111 1111 on file';
  const FILLER =
    'The handbook covers refunds within thirty days of purchase.\n';
  const LONG = [WITH_PII, FILLER.repeat(2_000), CARD, FILLER.repeat(10)].join(
    '\n',
  );
  const LONG_TAIL_ONLY = [FILLER.repeat(2_000), CARD].join('\n');

  it('masks a document longer than the engine clamp end to end', () => {
    expect(LONG.length).toBeGreaterThan(100_000);
    const decision = applyPiiPolicyForIndexing(
      LONG,
      policy({ enabledPatterns: ['email', 'creditCard'] }),
    );
    expect(decision.kind).toBe('index');
    if (decision.kind !== 'index') return;
    expect(decision.text).not.toContain('ada@example.com');
    expect(decision.text).not.toContain('4111 1111 1111 1111');
    expect(decision.text).toContain('[CREDIT_CARD]');
    // The tail survives: nothing past the clamp was dropped.
    expect(decision.text.endsWith(FILLER.repeat(10))).toBe(true);
    expect(decision.text.length).toBeGreaterThan(LONG.length - 100);
  });

  it('refuses a document whose only identifier sits past the engine clamp', () => {
    expect(LONG_TAIL_ONLY.length).toBeGreaterThan(100_000);
    const decision = applyPiiPolicyForIndexing(
      LONG_TAIL_ONLY,
      policy({ mode: 'block', enabledPatterns: ['creditCard'] }),
    );
    expect(decision).toEqual({ kind: 'refuse', categoryIds: ['creditCard'] });
  });

  it('refuses an identifier behind a head that doubles under NFC', () => {
    // U+0958 decomposes under NFC into two code units, so a window cut
    // under the engine clamp grows past it inside the engine; the clamped
    // prefix has no match and the identifier sits in the unscanned tail. A
    // crafted document must not walk past a block policy that way.
    const text = `${String.fromCharCode(0x0958).repeat(12_000)} ${CARD}`;
    const decision = applyPiiPolicyForIndexing(
      text,
      policy({ mode: 'block', enabledPatterns: ['creditCard'] }),
    );
    expect(decision).toEqual({ kind: 'refuse', categoryIds: ['creditCard'] });
    const masked = applyPiiPolicyForIndexing(
      text,
      policy({ enabledPatterns: ['creditCard'] }),
    );
    expect(masked.kind).toBe('index');
    if (masked.kind !== 'index') return;
    expect(masked.text).toContain('[CREDIT_CARD]');
    expect(masked.text).not.toContain('4111 1111 1111 1111');
  });

  it('indexes clean text unchanged', () => {
    const clean = 'The handbook covers refunds within 30 days.';
    expect(applyPiiPolicyForIndexing(clean, policy())).toEqual({
      kind: 'index',
      text: clean,
    });
  });

  it('indexes unscrubbed when the scrubber cannot be built, reporting once', async () => {
    // Construction throws only on a programmer error or a missing data tree,
    // and the governance resolver filters the usual trigger (an unknown
    // locale) upstream — so the failure is forced here. What matters is the
    // guarantee: failing the index would take an organization's corpus
    // offline over a governance typo — and the report is one error per
    // policy per process, not one per document.
    vi.resetModules();
    vi.doMock('../../../lib/pii', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../lib/pii')>()),
      createScrubberFromConfig: () => {
        throw new Error('no data tree at /app/system/pii');
      },
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { applyPiiPolicyForIndexing: withBrokenScrubber } =
      await import('./pii_gate');
    expect(withBrokenScrubber(WITH_PII, policy())).toEqual({
      kind: 'index',
      text: WITH_PII,
    });
    expect(withBrokenScrubber(WITH_PII, policy())).toEqual({
      kind: 'index',
      text: WITH_PII,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain('/app/system/pii');
    error.mockRestore();
    vi.doUnmock('../../../lib/pii');
    vi.resetModules();
  });
});

describe('scrubberForPolicy', () => {
  it('reuses one scrubber for equal policies and builds anew for a changed one', () => {
    // The engine's contract: build once per config, reuse per message. Two
    // documents under the same policy must not pay for two constructions.
    const first = scrubberForPolicy(policy({ mode: 'mask' }));
    const second = scrubberForPolicy(policy({ mode: 'mask' }));
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    const changed = scrubberForPolicy(policy({ mode: 'block' }));
    expect(changed).not.toBe(first);
  });

  it('caches the disabled verdict too', () => {
    expect(scrubberForPolicy(policy({ enabled: false }))).toBeNull();
    expect(scrubberForPolicy(policy({ enabled: false }))).toBeNull();
  });
});

describe('parsePiiConfig', () => {
  it('reads a policy out of its stored record', () => {
    const parsed = parsePiiConfig({
      value: { enabled: true, mode: 'mask', enabledPatterns: ['email'] },
    });
    expect(parsed?.mode).toBe('mask');
  });

  it('reads a bare policy object too', () => {
    const parsed = parsePiiConfig({
      enabled: true,
      mode: 'block',
      enabledPatterns: [],
    });
    expect(parsed?.mode).toBe('block');
  });

  it('treats an absent policy as no policy', () => {
    expect(parsePiiConfig(null)).toBeNull();
    expect(parsePiiConfig(undefined)).toBeNull();
  });

  it('treats an unparseable policy as no policy, with a warning', () => {
    // A stale or hand-edited governance row must not brick indexing.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePiiConfig({ value: { enabled: 'yes' } })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
