// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, useLayoutEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { cleanup, render } from '@/tests/utils/render';

import { testsOf } from '../lib/automation-tests/test-draft';
import type { RawDocument } from '../lib/draft-document';
import {
  type AutomationTests,
  useAutomationTests,
} from './use-automation-tests';

const io = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  report: undefined as unknown,
}));

vi.mock('./mutations', () => ({
  useRunAutomationTests: () => ({
    mutateAsync: io.mutateAsync,
    isPending: false,
  }),
}));
vi.mock('./queries', () => ({
  useAutomationTestReport: () => ({ data: io.report }),
}));

const STORED: RawDocument = {
  name: 'double',
  nodes: [{ id: 'double', type: 'transform', code: 'return input.n * 2;' }],
  output: '{{ nodes.double.output }}',
  tests: [
    { name: 'doubles seven', input: { n: 7 }, expect: { output: 14 } },
    { name: 'triples seven', input: { n: 7 }, expect: { output: 21 } },
  ],
};

const ANSWER = {
  report: {
    passed: 1,
    failed: 1,
    results: [
      { name: 'doubles seven', index: 0, pass: true, ms: 3 },
      {
        name: 'triples seven',
        index: 1,
        pass: false,
        ms: 4,
        failures: [{ kind: 'output', mode: 'exact', mismatches: [], total: 1 }],
      },
    ],
  },
};

let api: AutomationTests;
let setDraft: (next: RawDocument | null) => void;

function Harness({ slug }: { slug: string }) {
  const [draft, setDraftState] = useState<RawDocument | null>(null);
  const tests = useAutomationTests({
    organizationId: 'org-1',
    automationSlug: slug,
    draft,
    storedRaw: STORED,
    version: 4,
    enabled: true,
    editDraft: (edit) => setDraftState(edit(draft ?? STORED)),
    text: {},
  });
  // Handed to the test once each render has committed.
  useLayoutEffect(() => {
    api = tests;
    setDraft = setDraftState;
  }, [tests]);
  return null;
}

let slug = 0;
beforeEach(() => {
  cleanup();
  io.mutateAsync.mockReset();
  io.report = undefined;
  // Each test its own automation: the page keeps results per automation.
  slug += 1;
  render(<Harness slug={`ops/double-${slug}`} />);
});

describe('useAutomationTests', () => {
  it('lists the tests, none run yet', () => {
    expect(api.rows.map((row) => [row.name, row.status])).toEqual([
      ['doubles seven', 'not-run'],
      ['triples seven', 'not-run'],
    ]);
    expect(api.counts).toMatchObject({ notRun: 2, total: 2 });
    expect(api.source).toBe('Not run yet');
  });

  it("runs a saved version's tests on that version and keeps what they found", async () => {
    io.mutateAsync.mockResolvedValueOnce({
      ...ANSWER,
      recorded: { version: 4, testsPassed: false, checkedAt: 1 },
    });
    await act(async () => {
      api.runAll();
      await Promise.resolve();
    });
    expect(io.mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: `ops/double-${slug}`,
      version: 4,
    });
    expect(api.rows.map((row) => row.status)).toEqual(['passed', 'failed']);
    expect(api.rows[1]?.reason).toBe(
      'The output differs from what the test expects in 1 place.',
    );
    expect(api.rows[0]?.meta).toBe('3 ms');
    expect(api.announceKey).toBe(1);
  });

  it('runs the draft’s tests on the draft, one alone when asked', async () => {
    act(() => setDraft({ ...STORED, description: 'edited' }));
    io.mutateAsync.mockResolvedValueOnce({
      report: { passed: 1, failed: 0, results: [ANSWER.report.results[0]] },
    });
    await act(async () => {
      api.runOne(0);
      await Promise.resolve();
    });
    expect(io.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ description: 'edited' }),
        tests: [0],
      }),
    );
    expect(api.rows.map((row) => row.status)).toEqual(['passed', 'not-run']);
    expect(api.source).toBe('Run on your draft');
  });

  it('says which tests the run left out when its time was up', async () => {
    io.mutateAsync.mockResolvedValueOnce({
      report: {
        passed: 1,
        failed: 0,
        results: [ANSWER.report.results[0]],
        notRun: ['triples seven'],
      },
    });
    await act(async () => {
      api.runAll();
      await Promise.resolve();
    });
    expect(api.rows[1]).toMatchObject({
      status: 'not-run',
      reason: 'The tests ran out of time before this one.',
    });
  });

  it('marks a result changed since when the automation changes under it', async () => {
    io.mutateAsync.mockResolvedValueOnce(ANSWER);
    await act(async () => {
      api.runAll();
      await Promise.resolve();
    });
    act(() =>
      setDraft({ ...STORED, output: '{{ nodes.double.output }} done' }),
    );
    expect(api.rows.map((row) => row.status)).toEqual(['stale', 'stale']);
    // The result keeps its words: the status says it no longer holds.
    expect(api.rows[1]?.reason).toBeDefined();
  });

  it('waits out a spent budget and says when to try again', async () => {
    io.mutateAsync.mockRejectedValueOnce(
      new AppError({
        code: 'RATE_LIMITED',
        message: 'RATE_LIMITED',
        retryAfterMs: 3_000,
      }),
    );
    await act(async () => {
      api.runAll();
      await Promise.resolve();
    });
    expect(api.failure?.title).toBe(
      'Many tests ran just now. Try again in 3 seconds.',
    );
    expect(api.runDisabledReason).toBe(api.failure?.title);
    expect(api.status).toBe('failed');
  });

  it('points at Problems when the checks refuse the draft', async () => {
    io.mutateAsync.mockRejectedValueOnce(
      new AppError({
        code: 'AUTOMATION_INVALID',
        message: 'The automation does not pass the checks.',
        errors: [
          {
            level: 'error',
            code: 'REF_UNKNOWN_NODE',
            message: 'x',
            at: { pointer: '/output' },
          },
        ],
        warnings: [],
      }),
    );
    await act(async () => {
      api.runAll();
      await Promise.resolve();
    });
    expect(api.failure?.title).toBe(
      'The tests run once the automation passes its checks. Problems lists the 1 problem to fix.',
    );
    expect(api.status).toBe('failed');
    // Trying again asks for what the failed run asked for.
    io.mutateAsync.mockResolvedValueOnce(ANSWER);
    await act(async () => {
      api.retry();
      await Promise.resolve();
    });
    expect(io.mutateAsync).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ tests: expect.anything() }),
    );
    expect(api.failure).toBeNull();
  });

  it('adds, copies and deletes tests in the draft, results moving with them', async () => {
    io.mutateAsync.mockResolvedValueOnce(ANSWER);
    await act(async () => {
      api.runAll();
      await Promise.resolve();
    });
    let added: number | null = null;
    act(() => {
      added = api.add();
    });
    expect(added).toBe(2);
    expect(api.rows[2]).toMatchObject({ name: 'New test', status: 'not-run' });

    let copy: number | null = null;
    act(() => {
      copy = api.duplicate(0);
    });
    expect(copy).toBe(1);
    expect(api.rows.map((row) => row.name)).toEqual([
      'doubles seven',
      'doubles seven (copy)',
      'triples seven',
      'New test',
    ]);
    // The result of "triples seven" moved with it.
    expect(api.rows[2]?.status).toBe('failed');

    act(() => api.remove(0));
    expect(api.rows.map((row) => row.name)).toEqual([
      'doubles seven (copy)',
      'triples seven',
      'New test',
    ]);
    expect(api.rows[1]?.status).toBe('failed');
    expect(testsOf(STORED)).toHaveLength(2);
  });

  it("reads the version's kept report while nothing ran on this page", () => {
    cleanup();
    io.report = {
      report: {
        checkedAt: 1_791_000_000_000,
        passed: 1,
        failed: 0,
        results: [{ name: 'doubles seven', index: 0, pass: true, ms: 2 }],
      },
      testsPassed: true,
      testsCheckedAt: 1_791_000_000_000,
      via: 'deploy',
      by: 'user-1',
    };
    render(<Harness slug="ops/with-report" />);
    expect(api.rows.map((row) => row.status)).toEqual(['passed', 'not-run']);
    expect(api.source).toMatch(/^Checked when deploying version 4 · /);
  });
});
