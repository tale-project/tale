// The organization's PII policy, applied to text bound for the index.
//
// The engine itself is tested in `lib/pii`; what matters here is the mapping
// from a governance policy to an indexing decision — and that a text the
// policy cannot scan is never indexed as it is, in any mode.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_MESSAGE_BYTES } from '../../../lib/pii';
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

  it('indexes unchanged when the policy is disabled [KNOW-R9]', () => {
    // An organization that has not turned this on gets exactly today's
    // behaviour — this must not become an opt-out.
    const decision = applyPiiPolicyForIndexing(
      WITH_PII,
      policy({ enabled: false }),
    );
    expect(decision).toEqual({ kind: 'index', text: WITH_PII });
  });

  it('masks under mode mask, so the identifier never reaches the vectors [KNOW-R9]', () => {
    const decision = applyPiiPolicyForIndexing(WITH_PII, policy());
    expect(decision.kind).toBe('index');
    if (decision.kind !== 'index') return;
    expect(decision.text).not.toContain('ada@example.com');
    // The surrounding words survive, or the file stops being findable at all.
    expect(decision.text).toContain('about the role');
  });

  it('refuses under mode block, naming categories and not the matched text [KNOW-R9]', () => {
    const decision = applyPiiPolicyForIndexing(
      WITH_PII,
      policy({ mode: 'block' }),
    );
    expect(decision.kind).toBe('refuse');
    if (decision.kind !== 'refuse') return;
    expect(decision.categoryIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(decision.categoryIds)).not.toContain('ada@');
  });

  it('treats tokenize as mask, because an indexed chunk outlives a restore map [KNOW-R9]', () => {
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

  // An identifier straddling the window cut: the head is one unbroken word
  // as long as a window, so the only separators in the cut's range are the
  // spaces inside the card number itself — the shape of a single-line CSV
  // export. Pre-fix neither window saw the number: block passed, mask
  // indexed it raw. The filler sits outside every pattern's character
  // classes: on a letter run the email regex backtracks quadratically, and a
  // policy that enables it would push this file past the test timeout.
  const WINDOW_CHARS = Math.floor(MAX_MESSAGE_BYTES / 4);
  const STRADDLE = `${'#'.repeat(WINDOW_CHARS - 10)} 4111 1111 1111 1111 rest of the line`;

  it('refuses an identifier that straddles the window cut', () => {
    const decision = applyPiiPolicyForIndexing(
      STRADDLE,
      policy({ mode: 'block', enabledPatterns: ['creditCard'] }),
    );
    expect(decision).toEqual({ kind: 'refuse', categoryIds: ['creditCard'] });
  });

  it('masks an identifier that straddles the window cut', () => {
    const decision = applyPiiPolicyForIndexing(
      STRADDLE,
      policy({ enabledPatterns: ['creditCard'] }),
    );
    expect(decision.kind).toBe('index');
    if (decision.kind !== 'index') return;
    expect(decision.text).toContain('# [CREDIT_CARD] rest of the line');
    expect(decision.text).not.toContain('4111');
    expect(decision.text).not.toContain('1111');
  });

  it('indexes clean text unchanged', () => {
    const clean = 'The handbook covers refunds within 30 days.';
    expect(applyPiiPolicyForIndexing(clean, policy())).toEqual({
      kind: 'index',
      text: clean,
    });
  });
});

describe('a text the policy cannot scan', () => {
  // The engine never fails on its own here: construction throws only on a
  // programmer error or a missing data tree (the governance resolver filters
  // the usual trigger, an unknown locale, upstream), and a scan step only on
  // a fault. So the failure is put in the engine's place. What matters is
  // the guarantee: indexed as it is, the text would carry what the policy
  // keeps out to the embedding provider and the index — so no mode indexes
  // it.
  type PiiModule = typeof import('../../../lib/pii');

  const UNSCANNED = { kind: 'unscanned', cause: 'incomplete' } as const;
  const UNSCANNABLE = 'UNSCANNABLE-REGION';
  /** Longer than one scan window (12,500 code units), so a text that
   * carries it is scanned in two. */
  const FILLER = ' lorem'.repeat(2_500);

  /** The gate, over a stand-in for the engine's `createScrubberFromConfig`. */
  async function gateWith(
    create: (actual: PiiModule) => PiiModule['createScrubberFromConfig'],
  ): Promise<typeof import('./pii_gate')> {
    vi.resetModules();
    vi.doMock('../../../lib/pii', async (importOriginal) => {
      const actual = await importOriginal<PiiModule>();
      return { ...actual, createScrubberFromConfig: create(actual) };
    });
    return await import('./pii_gate');
  }

  /** The real scrubber, but a window holding `UNSCANNABLE` fails its scan
   * step — the step error a detector fault answers. */
  function failingOnMarker(
    actual: PiiModule,
  ): PiiModule['createScrubberFromConfig'] {
    return (config, registry) => {
      const real = actual.createScrubberFromConfig(config, registry);
      if (real === null) return null;
      return {
        ...real,
        scrub: (text) =>
          text.includes(UNSCANNABLE)
            ? { kind: 'step_error', filterName: 'pii', reason: 'timeout' }
            : real.scrub(text),
      };
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../../../lib/pii');
    vi.resetModules();
  });

  it('refuses it in every mode when the scrubber cannot be built, reporting once [KNOW-R9]', async () => {
    const { applyPiiPolicyForIndexing: withBrokenScrubber } = await gateWith(
      () => () => {
        throw new Error('no data tree at /app/system/pii');
      },
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const mode of ['mask', 'block', 'tokenize']) {
      expect(withBrokenScrubber(WITH_PII, policy({ mode }))).toEqual({
        kind: 'unscanned',
        cause: 'unavailable',
      });
    }
    // One error per policy per process, not one per document — naming the
    // fault, never the text, and no indexing that no longer happens.
    expect(withBrokenScrubber(WITH_PII, policy())).toEqual({
      kind: 'unscanned',
      cause: 'unavailable',
    });
    expect(error).toHaveBeenCalledTimes(3);
    const report = String(error.mock.calls[0]?.[0]);
    expect(report).toContain('/app/system/pii');
    expect(report).toContain('refusing to index');
    expect(report).not.toContain('unscrubbed');
    expect(report).not.toContain('ada@example.com');

    // The ledger of reported policies is bounded: 32 further distinct
    // failing policies evict the first three, and the first reports once
    // more — the price of a bound, not a leak.
    for (let i = 0; i < 32; i += 1) {
      withBrokenScrubber(WITH_PII, policy({ enabledPatterns: [`p${i}`] }));
    }
    expect(error).toHaveBeenCalledTimes(35);
    withBrokenScrubber(WITH_PII, policy());
    expect(error).toHaveBeenCalledTimes(36);
  });

  it('scans the next text once the scrubber builds again', async () => {
    // A failed construction is not cached: a repaired data tree heals
    // without a restart, and a save of the policy queues again what it
    // refused meanwhile.
    let broken = true;
    const { applyPiiPolicyForIndexing: gate } = await gateWith(
      (actual) => (config, registry) => {
        if (broken) throw new Error('no data tree at /app/system/pii');
        return actual.createScrubberFromConfig(config, registry);
      },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(gate(WITH_PII, policy()).kind).toBe('unscanned');
    broken = false;
    const decision = gate(WITH_PII, policy());
    expect(decision.kind).toBe('index');
    if (decision.kind !== 'index') return;
    expect(decision.text).not.toContain('ada@example.com');
  });

  it('refuses it in every mode when a part could not be scanned [KNOW-R9]', async () => {
    // The part that failed holds the address and no scanned part matched:
    // under `block` this is the text that used to be indexed as it is.
    const { applyPiiPolicyForIndexing: withFailingStep } =
      await gateWith(failingOnMarker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = `The handbook.${FILLER} ${UNSCANNABLE} ada@example.com`;
    for (const mode of ['mask', 'block', 'tokenize']) {
      expect(withFailingStep(text, policy({ mode }))).toEqual(UNSCANNED);
    }
    // Said once per text, with the engine's log-safe reason — never the
    // text. (Loading the data tree warns on its own; that is not the gate.)
    const said = warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('[pii-gate]'));
    expect(said).toHaveLength(3);
    for (const message of said) {
      expect(message).toContain('timeout');
      expect(message).not.toContain('ada@example.com');
      expect(message).not.toContain('lorem');
    }
  });

  it('does not index the rest masked when one part could not be scanned [KNOW-R9]', async () => {
    // The masked text would present the part that failed as scanned.
    const { applyPiiPolicyForIndexing: withFailingStep } =
      await gateWith(failingOnMarker);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = `${WITH_PII}${FILLER} ${UNSCANNABLE} bob@example.com`;
    expect(withFailingStep(text, policy({ mode: 'mask' }))).toEqual(UNSCANNED);
    expect(withFailingStep(text, policy({ mode: 'tokenize' }))).toEqual(
      UNSCANNED,
    );
    // Under `block`, an address in a part it did scan still refuses the text
    // for what it found — the cause an admin can act on.
    expect(withFailingStep(text, policy({ mode: 'block' }))).toEqual({
      kind: 'refuse',
      categoryIds: ['email'],
    });
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
