// Golden-file test: the documented example pair must stay in lockstep with the
// real offline pipeline. It guards the docs (a drifted example fails here) and
// exercises recording → report → compact on realistic, non-synthetic data.

import { describe, expect, test } from 'bun:test';

import { compactReport } from './compact';
import { loadRecording } from './recording';
import { buildReport } from './report';

const fromExamples = (name: string): URL =>
  new URL(`../examples/${name}`, import.meta.url);

describe('examples/', () => {
  test('sample-recording.json analyzes to sample-report.json', async () => {
    const recording = loadRecording(
      await Bun.file(fromExamples('sample-recording.json')).text(),
    );
    const compact = compactReport(buildReport(recording));
    const expected = await Bun.file(fromExamples('sample-report.json')).json();
    // Round-trip through JSON to drop undefined optionals and compare as data.
    expect(JSON.parse(JSON.stringify(compact))).toEqual(expected);
  });
});
