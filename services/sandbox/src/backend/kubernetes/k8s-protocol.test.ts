// Unit tests for the in-Pod ↔ spawner result-line protocol. The harvest
// container serializes its result onto one stdout line; the spawner reads the
// harvest container's logs and must recover exactly that result. This is on
// the critical path (it carries exitCode / outputs / stderr back), so it's
// worth pinning without a cluster.

import { describe, expect, test } from 'bun:test';

import {
  HARVEST_STARTED_MARKER,
  RESULT_MARKER,
  formatResultLine,
  formatStartedLine,
  parseResultLine,
  parseStartedLine,
  type K8sHarvestResult,
} from './k8s-protocol.ts';

const sample: K8sHarvestResult = {
  exitCode: 0,
  stderr: 'a warning\nwith a newline',
  stderrTruncated: false,
  outputFiles: [
    {
      name: 'deck.pptx',
      storageId: 'stor_123',
      size: 2048,
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sha256: 'abc123',
    },
  ],
  truncatedFiles: 1,
  uploadStats: { attempted: 1, succeeded: 1, failures: [] },
  quotaExhausted: false,
  uploadFailed: false,
  reportFailed: false,
  readFailed: false,
  stageMs: 120,
  harvestMs: 45,
  uploadMs: 30,
  steps: [{ path: 'a.py', status: 'completed', exitCode: 0, durationMs: 10 }],
  priorStage: { staged: [], skipped: [] },
};

describe('result line protocol', () => {
  test('round-trips a full result through format → parse', () => {
    const line = formatResultLine(sample);
    expect(line.startsWith(`${RESULT_MARKER} `)).toBe(true);
    // Must be exactly one line (JSON escapes the embedded newline in stderr).
    expect(line.includes('\n')).toBe(false);
    expect(parseResultLine(line)).toEqual(sample);
  });

  test('recovers the result when surrounded by other harvest log lines', () => {
    const logs = [
      '[sandbox.harvest] runner did not exit within 30000ms',
      'some other noise',
      formatResultLine(sample),
    ].join('\n');
    expect(parseResultLine(logs)).toEqual(sample);
  });

  test('picks the LAST marker line if more than one is present', () => {
    const first = formatResultLine({ ...sample, exitCode: 1 });
    const last = formatResultLine({ ...sample, exitCode: 0 });
    const parsed = parseResultLine(`${first}\n${last}`);
    expect(parsed?.exitCode).toBe(0);
  });

  test('returns null when no marker line is present', () => {
    expect(parseResultLine('just\nsome\nlogs')).toBeNull();
    expect(parseResultLine('')).toBeNull();
  });

  test('returns null on a malformed (non-JSON) marker payload', () => {
    expect(parseResultLine(`${RESULT_MARKER} {not valid json`)).toBeNull();
  });

  test('preserves a large embedded stderr faithfully', () => {
    const big = 'x'.repeat(200_000);
    const withBig: K8sHarvestResult = { ...sample, stderr: big };
    const parsed = parseResultLine(formatResultLine(withBig));
    expect(parsed?.stderr).toBe(big);
  });
});

describe('harvest started line', () => {
  test('round-trips through format → parse and is one line', () => {
    const line = formatStartedLine({ exitCode: 7, timedOut: false });
    expect(line.startsWith(`${HARVEST_STARTED_MARKER} `)).toBe(true);
    expect(line.includes('\n')).toBe(false);
    expect(parseStartedLine(line)).toEqual({ exitCode: 7, timedOut: false });
  });

  test('started + result lines coexist without confusing either parser', () => {
    const logs = [
      formatStartedLine({ exitCode: 0, timedOut: false }),
      'harvest progress noise',
      formatResultLine(sample),
    ].join('\n');
    expect(parseStartedLine(logs)).toEqual({ exitCode: 0, timedOut: false });
    expect(parseResultLine(logs)).toEqual(sample);
  });

  test('returns null when absent or malformed', () => {
    expect(parseStartedLine('no markers here')).toBeNull();
    expect(parseStartedLine(`${HARVEST_STARTED_MARKER} {broken`)).toBeNull();
  });

  test('user output containing the marker mid-line is not a match', () => {
    // Only LINE-PREFIX matches count; the runner's stdout never reaches the
    // harvest log anyway, but be strict.
    expect(
      parseStartedLine(`echoed ${HARVEST_STARTED_MARKER} {"exitCode":9}`),
    ).toBeNull();
  });
});
