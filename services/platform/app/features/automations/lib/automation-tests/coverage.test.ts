import { describe, expect, it } from 'vitest';

import { coveredCount, pathCoverage } from './coverage';
import type { TestOutcome } from './test-results';

function ran(path: string | undefined, stale = false): TestOutcome {
  return {
    kind: 'run',
    stale,
    at: 1,
    result: {
      name: 'x',
      index: 0,
      pass: true,
      ms: 1,
      ...(path !== undefined && { path: { id: path, assignment: {} } }),
    },
  };
}

describe('which paths the tests go down', () => {
  it('names the tests of each path, from results that still hold', () => {
    const coverage = pathCoverage([
      { name: 'reply', outcome: ran('when:triage=1') },
      { name: 'newsletter', outcome: ran('when:triage=1') },
      { name: 'quiet inbox', outcome: ran('when:triage=0', true) },
      { name: 'not run', outcome: { kind: 'none' } },
      { name: 'no path', outcome: ran(undefined) },
      {
        name: 'kept report',
        outcome: {
          kind: 'report',
          stale: false,
          at: 1,
          result: {
            name: 'kept report',
            index: 5,
            pass: true,
            ms: 1,
            path: '',
          },
        },
      },
    ]);
    expect([...coverage]).toEqual([
      ['when:triage=1', ['reply', 'newsletter']],
      ['', ['kept report']],
    ]);
    expect(
      coveredCount(coverage, [
        { id: 'when:triage=1' },
        { id: 'when:triage=0' },
      ]),
    ).toBe(1);
  });
});
