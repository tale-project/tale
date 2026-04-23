import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentJsonConfig } from '../../../../convex/agents/file_utils';
import { isNormalized, normalizeAgentConfig } from '../normalize-agent-config';

/**
 * Every agent JSON in `examples/agents/` is treated as part of the shipped
 * product — new orgs scaffold their agent directory by copying these files
 * via `scaffoldNewOrganization`, which goes around the `normalizeAgentConfig`
 * write boundary. If an example ever drifts into a non-normalized shape
 * (legacy top-level co-existing with i18n[defaultLocale], empty-string
 * placeholders, etc.), new orgs will inherit the pollution on creation.
 *
 * This test pins the invariant at build time so any drift fails CI.
 */

const EXAMPLES_DIR = path.resolve(
  __dirname,
  '../../../../../../examples/agents',
);

describe('examples/agents/*.json invariants', () => {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'));

  it('discovered at least one example agent', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} is normalized`, () => {
      const raw = readFileSync(path.join(EXAMPLES_DIR, file), 'utf-8');
      const config = JSON.parse(raw) as AgentJsonConfig;
      // `isNormalized` is checked against the app default locale. Example
      // agents are shipped with english as the canonical locale; orgs that
      // pick a non-en defaultLocale see their own writes normalized via
      // `normalizeAgentConfig` at save time.
      expect(isNormalized(config)).toBe(true);
      // Stronger: applying normalize is a no-op (idempotence baseline).
      expect(normalizeAgentConfig(config)).toEqual(config);
    });
  }
});
