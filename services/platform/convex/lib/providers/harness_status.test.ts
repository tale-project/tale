// The status derivation runs against the REAL shipped harness facts — the
// yml files are the contract, so a policy change there (a harness gaining or
// losing managed/byo support) must surface here, not in a fixture that
// silently drifts.

import { describe, expect, it } from 'vitest';

import {
  deriveHarnessStatus,
  type SubscriptionCredentialFact,
} from './harness_status';
import { loadHarnesses } from './load_system_config';

const HARNESSES = loadHarnesses();
const DIRECT = [{ id: 'deepseek/deepseek-v3.2' }, { id: 'zai/glm-5' }];

function subscription(
  providerSlug: string,
  harness: string,
): SubscriptionCredentialFact {
  return {
    providerSlug,
    credential: {
      authMethod: 'subscription-key',
      constraints: { execution: 'sandbox', harness },
    },
  };
}

function entryOf(
  rows: ReturnType<typeof deriveHarnessStatus>,
  slug: string,
): ReturnType<typeof deriveHarnessStatus>[number] {
  const row = rows.find((candidate) => candidate.slug === slug);
  if (!row) throw new Error(`no status row for harness "${slug}"`);
  return row;
}

describe('deriveHarnessStatus — against the real shipped harness facts', () => {
  it('offers the managed lane with the direct pool and the kick default', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: DIRECT,
      subscriptions: [],
    });

    expect(entryOf(rows, 'claude-code').managed).toEqual({
      available: true,
      modelCount: 2,
      // The first direct-served model IS the turn's fallback default.
      defaultModelId: 'deepseek/deepseek-v3.2',
    });
  });

  it('omits byo-only harnesses (cursor) from the status list', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: DIRECT,
      subscriptions: [],
    });

    expect(rows.some((row) => row.slug === 'cursor')).toBe(false);
    expect(
      rows.every((row) => {
        const harness = HARNESSES.find((entry) => entry.slug === row.slug);
        return harness?.credentialPolicy.managed === true;
      }),
    ).toBe(true);
  });

  it('reports the missing direct credential when nothing is direct-served', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: [],
      subscriptions: [],
    });

    expect(entryOf(rows, 'claude-code').managed).toEqual({
      available: false,
      reason: 'no-direct-credential',
    });
  });

  it('attaches a subscription to its forced harness only, usable when byo is accepted', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: DIRECT,
      subscriptions: [subscription('zai', 'claude-code')],
    });

    expect(entryOf(rows, 'claude-code').subscriptions).toEqual([
      { providerSlug: 'zai', usable: true },
    ]);
    expect(entryOf(rows, 'codex').subscriptions).toEqual([]);
  });

  it('flags a subscription bound to a managed-only harness (opencode) as inert', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: DIRECT,
      subscriptions: [subscription('nous', 'opencode')],
    });

    expect(entryOf(rows, 'opencode').subscriptions).toEqual([
      { providerSlug: 'nous', usable: false },
    ]);
  });

  it('collapses several credentials of one vendor into one row, usable when any is', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: DIRECT,
      subscriptions: [
        subscription('zai', 'claude-code'),
        subscription('zai', 'claude-code'),
      ],
    });

    expect(entryOf(rows, 'claude-code').subscriptions).toEqual([
      { providerSlug: 'zai', usable: true },
    ]);
  });

  it('sorts the rows by display label', () => {
    const rows = deriveHarnessStatus({
      harnesses: HARNESSES,
      directModels: DIRECT,
      subscriptions: [],
    });

    const labels = rows.map((row) => row.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(labels.length).toBeGreaterThan(0);
  });
});
