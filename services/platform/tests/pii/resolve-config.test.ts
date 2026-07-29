/**
 * Governance policy → running scrubber, end to end.
 *
 * The chain under test: a raw org `pii_config` document validated by the
 * FROZEN policy schema (`lib/shared/schemas/pii.ts`) → resolved against
 * the loaded registry (`resolveScrubberOptions`) → a scrubber whose
 * behaviour matches the policy. This is the wiring the chat guardrail
 * pipeline will call when it returns with the chat rebuild.
 *
 * Degradation contract: unknown pattern names and unknown locales in a
 * stale config are logged and skipped — never a throw, never a bricked
 * pipeline.
 */

import { describe, expect, it } from 'vitest';

import {
  PatternRegistry,
  createScrubberFromConfig,
  createTokenizer,
  resolveScrubberOptions,
} from '../../lib/pii';
import { piiConfigSchema } from '../../lib/shared/schemas/pii';

const REGISTRY = PatternRegistry.fromDefaults();

/** Unwrap a resolver result that the test expects to be non-null. */
function must<T>(value: T | null): T {
  if (value === null) throw new Error('expected a non-null resolver result');
  return value;
}

const SAMPLE = 'Reach me at alice@example.com, IBAN DE89370400440532013000.';

describe('config → scrubber', () => {
  it('masks an email and an IBAN per a mask-mode policy', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email', 'iban'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    const o = scrubber.scrub(SAMPLE);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Reach me at [EMAIL], IBAN [IBAN].');
    expect(o.categoryIds).toEqual(expect.arrayContaining(['email', 'iban']));
    expect(o.matchCount).toBe(2);
  });

  it('tokenizes with indexed tokens per a tokenize-mode policy', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'tokenize',
      enabledPatterns: ['email', 'iban'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    const o = scrubber.scrub(SAMPLE);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Reach me at [EMAIL_1], IBAN [IBAN_1].');
  });

  it('round-trips through a tokenizer built from resolved options', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'tokenize',
      enabledPatterns: ['email', 'iban'],
    });
    const options = must(resolveScrubberOptions(config, REGISTRY));
    const tokenizer = createTokenizer(options);
    const r = tokenizer.tokenize(SAMPLE);
    expect(r.text).not.toContain('alice@example.com');
    expect(tokenizer.detokenize(r.text, r.mapping)).toBe(SAMPLE);
  });

  it('blocks per a block-mode policy', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'block',
      enabledPatterns: ['email'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    const o = scrubber.scrub(SAMPLE);
    expect(o.kind).toBe('blocked');
    if (o.kind !== 'blocked') return;
    expect(o.categoryIds).toContain('email');
  });

  it('returns null for a disabled policy', () => {
    const config = piiConfigSchema.parse({
      enabled: false,
      mode: 'mask',
      enabledPatterns: ['email'],
    });
    expect(resolveScrubberOptions(config, REGISTRY)).toBeNull();
    expect(createScrubberFromConfig(config, REGISTRY)).toBeNull();
  });
});

describe('degradation on stale configs', () => {
  it('skips unknown pattern names without throwing', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['email', 'retiredPatternFromOldConfig'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    const o = scrubber.scrub(SAMPLE);
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toContain('[EMAIL]');
    // The IBAN stays: only the known enabled pattern ran.
    expect(o.text).toContain('DE89370400440532013000');
  });

  it('skips unknown locales and keeps known ones', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['nationalId'],
      locales: ['de', 'xx-unknown'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    // German Personalausweis spec is active via the `de` dataset.
    const o = scrubber.scrub('Ausweisnummer C12345670');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Ausweisnummer [GERMAN_ID]');
  });

  it('yields a passing scrubber when every enabled name is unknown', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['definitelyNotAPattern'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    expect(scrubber.scrub(SAMPLE).kind).toBe('pass');
  });
});

describe('policy locale filter', () => {
  it('restricts locale-aware patterns to the configured set', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: ['nationalId'],
      locales: ['fr'],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    // A German Personalausweis is out of scope for a fr-only policy.
    expect(scrubber.scrub('Ausweisnummer C12345670').kind).toBe('pass');
  });
});

describe('policy custom patterns', () => {
  it('compiles schema-gated custom patterns into the scrubber', () => {
    const config = piiConfigSchema.parse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: [],
      customPatterns: [
        {
          name: 'employeeId',
          regex: 'EMP-\\d{5}',
          replacement: '[EMPLOYEE_ID]',
        },
      ],
    });
    const scrubber = must(createScrubberFromConfig(config, REGISTRY));
    const o = scrubber.scrub('Badge EMP-12345 checked in');
    expect(o.kind).toBe('modified');
    if (o.kind !== 'modified') return;
    expect(o.text).toBe('Badge [EMPLOYEE_ID] checked in');
  });

  it('rejects an unsafe custom regex at the schema gate', () => {
    const parsed = piiConfigSchema.safeParse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: [],
      customPatterns: [
        { name: 'evil', regex: '(a+)+$', replacement: '[EVIL]' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
