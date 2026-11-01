import { describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  durationText,
  failureSentence,
  resultReason,
  testBadges,
  type TestFailureView,
  type TestTextContext,
} from './test-text';

function ctx(locale: string): TestTextContext {
  const t = i18n.getFixedT(locale);
  return {
    t: (key, options) => t(key, options),
    locale,
    effectLabel: (connector) =>
      connector === 'gmail.send_email' ? 'Gmail · Send email' : connector,
  };
}

const FAILURES: TestFailureView[] = [
  { kind: 'output', mode: 'exact', mismatches: [], total: 2 },
  { kind: 'output', mode: 'includes', mismatches: [], total: 1 },
  {
    kind: 'effect_missing',
    entry: 0,
    connector: 'gmail.send_email',
    node: 'notify',
    actual: [],
  },
  {
    kind: 'effect_present',
    entry: 0,
    connector: 'gmail.send_email',
    node: 'notify',
  },
  { kind: 'node_state', node: 'triage', expected: 'skipped', actual: 'ran' },
  { kind: 'run_failed', node: 'score', message: 'boom' },
  { kind: 'run_succeeded', expected: { node: 'score' } },
  {
    kind: 'failed_elsewhere',
    expectedNode: 'score',
    actualNode: 'notify',
    message: 'x',
  },
  { kind: 'failure_message', expected: 'quota', actual: 'boom', node: 'score' },
  { kind: 'refused', issues: [] },
  { kind: 'timeout', limitMs: 10_000 },
];

describe('a test failure in words', () => {
  it('says each kind of failure in English, naming nodes as the canvas does', () => {
    const en = ctx('en');
    expect(FAILURES.map((failure) => failureSentence(failure, en))).toEqual([
      'The output differs from what the test expects in 2 places.',
      '1 field the test checks is missing or different.',
      "The test expects Gmail · Send email from Notify, but it didn't happen.",
      'The test expects Gmail · Send email not to happen, but Notify did it.',
      'The test expects Triage to be skipped, but it ran.',
      'The run failed at Score.',
      'The test expects the run to fail at Score, but it succeeded.',
      'The test expects the run to fail at Score, but it failed at Notify.',
      'The run failed at Score, but with a different error than the test expects.',
      "The test couldn't run: the automation has 1 problem to fix first.",
      'The test took longer than 10 seconds and was stopped.',
    ]);
  });

  it('words a failure without a node, and one a report kept by kind alone', () => {
    const en = ctx('en');
    expect(
      failureSentence(
        { kind: 'effect_missing', entry: 0, connector: 'x.y', actual: [] },
        en,
      ),
    ).toBe("The test expects x.y, but it didn't happen.");
    expect(failureSentence({ kind: 'output' }, en)).toBe(
      "The test didn't pass.",
    );
    expect(failureSentence({ kind: 'from_a_newer_server' }, en)).toBe(
      "The test didn't pass.",
    );
  });

  it('says every failure in German and French too', () => {
    for (const locale of ['de', 'fr']) {
      const local = ctx(locale);
      for (const failure of FAILURES) {
        const sentence = failureSentence(failure, local);
        expect(sentence).not.toMatch(/^tests\./);
        expect(sentence).not.toMatch(/[{}]/);
      }
    }
    expect(
      failureSentence(
        {
          kind: 'node_state',
          node: 'triage',
          expected: 'ran',
          actual: 'skipped',
        },
        ctx('de'),
      ),
    ).toBe(
      'Der Test erwartet, dass Triage läuft, aber sie wurde übersprungen.',
    );
    expect(
      failureSentence({ kind: 'timeout', limitMs: 1_000 }, ctx('fr')),
    ).toBe('Le test a duré plus de 1 seconde et a été arrêté.');
  });
});

describe('a test row in words', () => {
  it('leads with the first failure, and says nothing for a pass', () => {
    const en = ctx('en');
    expect(
      resultReason(
        {
          name: 'x',
          index: 0,
          pass: false,
          ms: 1,
          failures: FAILURES.slice(4, 6),
        },
        en,
      ),
    ).toBe('The test expects Triage to be skipped, but it ran.');
    expect(
      resultReason({ name: 'x', index: 0, pass: true, ms: 1 }, en),
    ).toBeUndefined();
    expect(resultReason({ name: 'x', index: 0, pass: false, ms: 1 }, en)).toBe(
      "The test didn't pass.",
    );
    expect(durationText(12.6, en)).toBe('13 ms');
  });

  it('counts what a test stands in for', () => {
    const en = ctx('en');
    expect(
      testBadges(
        { mocks: { fetch: [], draft: 'x' }, failures: { send: 'quota' } },
        en,
      ),
    ).toEqual(['Simulates 2 nodes', 'Simulates 1 failure']);
    // A node it picks a scenario for is simulated too, and counted once.
    expect(
      testBadges(
        {
          mocks: { fetch: [] },
          scenarios: { post: 'channel_not_found', fetch: 'empty' },
        },
        en,
      ),
    ).toEqual(['Simulates 2 nodes']);
    expect(testBadges({ name: 'plain' }, en)).toEqual([]);
    expect(testBadges(null, en)).toEqual([]);
  });
});
