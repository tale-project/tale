// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunDiff } from '@/app/lib/backend/contract/automations';
import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { RunComparePage } from './run-compare-page';

// The page runs its real lane: `useRunCompare`, the adapter, `backendFetch`
// and react-query; `fetch` answers the comparison door the way the backend
// does. Links render as plain anchors: no router is mounted.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
}));
// The canvas lays out in a real browser; here it says what it was handed:
// the steps it draws, and the ones each run's version lacks.
vi.mock('./automation-canvas', () => ({
  AutomationCanvas: ({
    automation,
    graph,
    compare,
  }: {
    automation: { nodes: Array<{ id: string }> };
    graph?: { nodes: Array<{ id: string; kind: string }> };
    compare?: { absentInA?: readonly string[]; absentInB?: readonly string[] };
  }) => (
    <div
      data-testid="compare-canvas"
      data-steps={(graph === undefined
        ? automation.nodes.map((step) => step.id)
        : graph.nodes.filter((box) => box.kind === 'step').map((box) => box.id)
      ).join(',')}
      data-absent-a={(compare?.absentInA ?? []).join(',')}
      data-absent-b={(compare?.absentInB ?? []).join(',')}
    />
  ),
}));

const ORG = 'org-1';

const same = {
  equal: true,
  changes: [],
  counts: {},
  total: 0,
  truncated: false,
  basis: 'none',
} as unknown as RunDiff['input'];

function node(
  nodeId: string,
  a: string | undefined,
  b: string | undefined,
  over: Partial<RunDiff['nodes'][number]> = {},
): RunDiff['nodes'][number] {
  return {
    path: nodeId,
    nodeId,
    ...(a !== undefined && {
      a: { status: a as 'ok', activeMs: 10, attempt: 1 },
    }),
    ...(b !== undefined && {
      b: { status: b as 'ok', activeMs: 10, attempt: 1 },
    }),
    decisions: [],
    input: same,
    output: same,
    ...over,
  };
}

const DIFF: RunDiff = {
  a: {
    id: 'run-a-1',
    version: 4,
    mode: 'mock',
    status: 'success',
    startedAt: 1,
  },
  b: {
    id: 'run-b-2',
    version: 4,
    mode: 'mock',
    status: 'failed',
    startedAt: 2,
  },
  version: { same: true, changed: [], added: [], removed: [] },
  input: { ...same, equal: false, total: 1 },
  output: same,
  nodes: [
    node('__start', 'ok', 'ok'),
    node('issues', 'ok', 'ok'),
    node('score', 'skipped', 'failed', {
      differs: 'status',
      input: { ...same, equal: false, total: 1 },
    }),
    node('__end', 'ok', undefined),
  ],
  firstDivergence: { path: 'score', why: 'status' },
  effects: { count: { a: 0, b: 0 }, onlyA: [], onlyB: [], changed: [] },
};

/** The two runs' own reads, for the input and output diffs. */
const RUNS: Record<string, Record<string, unknown>> = {
  '/api/app/automations/runs/run-a-1': {
    id: 'run-a-1',
    name: 'triage',
    version: 4,
    status: 'success',
    mode: 'mock',
    startedBy: 'user:ada',
    startedAt: 1,
    agentAutoRetryMax: 0,
    input: { amount: 250, currency: 'CHF' },
    output: null,
  },
  '/api/app/automations/runs/run-b-2': {
    id: 'run-b-2',
    name: 'triage',
    version: 4,
    status: 'failed',
    mode: 'mock',
    startedBy: 'user:ada',
    startedAt: 2,
    agentAutoRetryMax: 0,
    input: { amount: 2500, currency: 'CHF' },
    output: null,
  },
};

/** The automation's versions the canvas reads, by number. */
const VERSIONS: Record<string, Record<string, unknown>> = {
  '3': {
    name: 'triage',
    version: 3,
    deployedVersion: 4,
    document: {
      name: 'triage',
      nodes: [
        { id: 'issues', type: 'transform', code: "return 'i';" },
        { id: 'notify', type: 'transform', code: "return 'n';" },
      ],
    },
  },
  '4': {
    name: 'triage',
    version: 4,
    deployedVersion: 4,
    document: {
      name: 'triage',
      nodes: [
        { id: 'issues', type: 'transform', code: "return 'i';" },
        { id: 'score', type: 'transform', code: "return 's';" },
      ],
    },
  },
};

let answer: () => Response;

beforeEach(() => {
  answer = () => Response.json({ diff: DIFF });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    const url = new URL(href, 'http://localhost');
    if (url.pathname === '/api/app/automations/runs/run-a-1/compare/run-b-2') {
      return answer();
    }
    const run = RUNS[url.pathname];
    if (run !== undefined) return Response.json({ run });
    const version = url.searchParams.get('version');
    if (url.pathname === '/api/app/automations/triage' && version !== null) {
      const stored = VERSIONS[version];
      if (stored !== undefined) return Response.json(stored);
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(
  props: { a?: string; b?: string; automationSlug?: string } = {},
) {
  const onSwap = vi.fn();
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RunComparePage
        organizationId={ORG}
        runsPath={`/dashboard/${ORG}/automations/triage/runs`}
        a="run-a-1"
        b="run-b-2"
        onSwap={onSwap}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onSwap };
}

describe('RunComparePage', () => {
  it("shows how the two runs' inputs differ, field by field", async () => {
    renderPage();
    const heading = await screen.findByRole('heading', {
      name: 'Input: A → B',
    });
    const section = heading.closest('section');
    expect(section).toHaveTextContent(/amount/);
    // The output did not differ: no diff for it.
    expect(screen.queryByRole('heading', { name: 'Output: A → B' })).toBeNull();
  });

  it('says what differs, and lists every step as each run left it', async () => {
    const { user, onSwap } = renderPage();

    expect(
      await screen.findByText('They split at Score: it ended differently.'),
    ).toBeVisible();
    expect(screen.getByText('Input: 1 field differs.')).toBeVisible();
    expect(screen.getByText('A succeeded; B failed.')).toBeVisible();

    const table = screen.getByRole('table', { name: 'Steps in A and B' });
    const rows = within(table).getAllByRole('row');
    // A header, then the version's own steps: Start and End are not rows.
    expect(rows).toHaveLength(3);
    const score = within(table).getByRole('rowheader', { name: 'Score' });
    const cells = within(score.closest('tr') as HTMLElement).getAllByRole(
      'cell',
    );
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Skipped',
      'Failed',
      'differs',
    ]);

    expect(screen.getByRole('link', { name: 'Run runa1' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Swap A and B' }));
    expect(onSwap).toHaveBeenCalled();
  });

  it('passes an axe audit', async () => {
    const { container } = renderPage();
    await screen.findByText('Input: 1 field differs.');
    await checkAccessibility(container);
  });

  it("draws runs of two versions on both versions' steps, and leads to what changed between them", async () => {
    answer = () =>
      Response.json({
        diff: {
          ...DIFF,
          a: { ...DIFF.a, version: 3 },
          b: { ...DIFF.b, version: 4 },
          version: {
            same: false,
            changed: [],
            added: ['score'],
            removed: ['notify'],
          },
          nodes: [
            node('__start', 'ok', 'ok'),
            node('issues', 'ok', 'ok'),
            node('score', undefined, 'failed', { differs: 'missing' }),
            node('notify', 'ok', undefined, { differs: 'missing' }),
            node('__end', 'ok', undefined),
          ],
          firstDivergence: { path: 'score', why: 'missing' },
        },
      });
    renderPage({ automationSlug: 'triage' });
    expect(
      await screen.findByRole('link', {
        name: 'See what changed between v3 and v4',
      }),
    ).toBeVisible();
    // Each run's card links its version.
    expect(
      screen.getByRole('link', { name: 'v3. Open it in the editor.' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('link', {
        name: 'v4, live. Open it in the editor.',
      }),
    ).toBeVisible();
    // The chart holds both versions' steps; each run's version lacks one.
    const canvas = await screen.findByTestId('compare-canvas');
    await vi.waitFor(() =>
      expect(canvas.dataset.steps?.split(',').sort()).toEqual([
        'issues',
        'notify',
        'score',
      ]),
    );
    expect(canvas.dataset.absentA).toBe('score');
    expect(canvas.dataset.absentB).toBe('notify');
  });

  it('asks for two different runs', () => {
    renderPage({ b: 'run-a-1' });
    expect(screen.getByText('Choose two different runs.')).toBeVisible();
  });

  it('says when two runs cannot be compared', async () => {
    answer = () =>
      Response.json(
        { error: 'different automations', code: 'RUN_COMPARE_MISMATCH' },
        { status: 400 },
      );
    renderPage();
    expect(
      await screen.findByText(/These two runs can't be compared/),
    ).toBeVisible();
  });
});
