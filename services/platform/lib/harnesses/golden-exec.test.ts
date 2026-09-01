// The behavior-preservation gate of the config-first harness layer: for
// every shipped harness YAML, the generic interpreter (composed via the
// registry) must rebuild the frozen golden execs BYTE FOR BYTE. The goldens
// under fixtures/exec/ (YAML, one file per slug) were captured from the
// retired per-slug glue modules over the shared spec battery (test-helpers)
// before those modules were deleted — qwen-code, which never had a glue
// module, was authored from its YAML facts and frozen the same way. Any
// intended behavior change must re-freeze the affected fixture deliberately.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadHarnesses } from '../../backend/core/lib/providers/load_system_config';
import { composeHarnessGlue } from './registry';
import {
  goldenBattery,
  readExecFixture,
  serializeExecFixture,
} from './test-helpers';
import { HARNESS_SLUGS } from './types';

beforeEach(() => {
  // The claude transforms read these operator knobs off process.env; the
  // goldens pin the default-on behaviours (1M context, ultrathink, house
  // rules) regardless of the host shell.
  vi.stubEnv('TALE_SANDBOX_CONTEXT_1M', undefined);
  vi.stubEnv('TALE_SANDBOX_ULTRATHINK', undefined);
  vi.stubEnv('TALE_SANDBOX_HOUSE_RULES', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('golden exec fixtures (shipped YAML tree)', () => {
  const facts = loadHarnesses();

  it('covers every shipped slug', () => {
    expect(facts.map((f) => f.slug).sort()).toEqual([...HARNESS_SLUGS].sort());
  });

  it.each(facts.map((fact) => [fact.slug, fact] as const))(
    '%s rebuilds its golden execs byte for byte',
    (slug, fact) => {
      const glue = composeHarnessGlue(fact);
      const cases = goldenBattery()
        .filter(({ mode }) =>
          mode === 'managed'
            ? fact.credentialPolicy.managed
            : fact.credentialPolicy.byo,
        )
        .map(({ name, spec }) => ({ name, exec: glue.buildExec(spec) }));
      // Structural equality over the parsed fixture: every semantic byte
      // lives in the leaves (argv tokens, env values, the stdin payload
      // string with its pinned key order), which compare exactly — while
      // the fixture FILE's YAML layout stays free for the repo formatter.
      // readExecFixture already returns parsed YAML data; serializeExecFixture
      // is reparsed to the same JSON-shaped structure for the comparison.
      expect(JSON.parse(serializeExecFixture(cases))).toEqual(
        readExecFixture(slug),
      );
    },
  );
});
