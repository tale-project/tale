import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { i18n } from '../../../../lib/i18n/i18n';

const { state, resolveApproval, readApproval, refetchRun } = vi.hoisted(() => ({
  state: {
    status: 'waiting',
    finishedAt: null as number | null,
    detail: 'approval:250a93eb-9413-4699-94e8-ee3164e5e545' as string | null,
    waitingFor: 'approval' as string | undefined,
    startedBy: 'user:user-me',
    startedVia: undefined as string | undefined,
    trace: null as unknown,
    versionDocument: {
      name: 'docs-approval-proof',
      nodes: [],
    } as unknown,
    versionError: undefined as unknown,
    versionPending: false,
    runPending: false,
    runError: undefined as unknown,
    runMissing: false,
    runFetching: false,
    runFailureCount: 0,
    realRunRead: false,
  },
  resolveApproval: vi.fn(() => Promise.resolve(null)),
  readApproval: vi.fn(),
  refetchRun: vi.fn(() => Promise.resolve()),
}));

vi.mock('../hooks/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/queries')>();
  return {
    useAutomationRun: (organizationId: string, runId: string) =>
      state.realRunRead
        ? actual.useAutomationRun(organizationId, runId)
        : {
            isError: state.runError !== undefined,
            isPending: state.runPending,
            error: state.runError,
            isFetching: state.runFetching,
            errorUpdateCount:
              state.runError === undefined ? state.runFailureCount : 1,
            refetch: refetchRun,
            data: state.runMissing
              ? null
              : state.runPending || state.runError !== undefined
                ? undefined
                : {
                    id: 'run-proof',
                    name: 'docs-approval-proof',
                    version: 1,
                    mode: 'live',
                    startedAt: 1789363168936,
                    input: {},
                    output: null,
                    effects: [],
                    ...state,
                  },
          },
    useAutomation: () =>
      state.versionPending
        ? { data: undefined, isError: false, error: null }
        : state.versionError === undefined
          ? { data: { document: state.versionDocument }, isError: false }
          : { data: undefined, isError: true, error: state.versionError },
    useNodeTypeCatalog: () => ({ data: [], isError: false }),
    useRunPendingAsk: () => ({ data: null }),
    useRunApproval: (organizationId: string, approvalId: string) => {
      readApproval(organizationId, approvalId);
      return {
        data: {
          status: 'pending',
          metadata: {
            connector: 'imap-smtp',
            action: 'send',
            nodeId: 'deliver',
            parameters: { subject: 'Approval proof' },
          },
        },
      };
    },
  };
});
const cancelRun = vi.hoisted(() => vi.fn());
vi.mock('../hooks/mutations', () => ({
  useCancelAutomationRun: () => ({ mutate: cancelRun, isPending: false }),
  useResolveRunApproval: () => ({
    mutateAsync: resolveApproval,
    isPending: false,
  }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      { userId: 'user-me', displayName: 'Zoe A.', email: 'zoe@example.test' },
      {
        userId: 'user-dana',
        displayName: 'Dana K.',
        email: 'dana@example.test',
      },
    ],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));
vi.mock('./automation-canvas', () => ({
  AutomationCanvas: ({
    graph,
    runStatusByNode,
  }: {
    graph: { nodes: Array<{ id: string; type: string }> };
    runStatusByNode: ReadonlyMap<string, string>;
  }) => (
    <ul data-testid="canvas">
      {graph.nodes.map((node) => (
        <li key={node.id}>
          {node.id} ({node.type}): {runStatusByNode.get(node.id)}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('./node-inspector', () => ({ NodeInspector: () => null }));
vi.mock('./agent-execution-log', () => ({ AgentExecutionLog: () => null }));
vi.mock('@tale/ui/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre>{JSON.stringify(data)}</pre>
  ),
}));

import { RunDetail } from './run-detail';

beforeEach(() => {
  state.status = 'waiting';
  state.finishedAt = null;
  state.detail = 'approval:250a93eb-9413-4699-94e8-ee3164e5e545';
  state.waitingFor = 'approval';
  state.startedBy = 'user:user-me';
  state.startedVia = undefined;
  state.trace = null;
  state.versionDocument = { name: 'docs-approval-proof', nodes: [] };
  state.versionError = undefined;
  state.versionPending = false;
  state.runPending = false;
  state.runError = undefined;
  state.runMissing = false;
  state.runFetching = false;
  state.runFailureCount = 0;
  state.realRunRead = false;
  vi.clearAllMocks();
});

function renderRun() {
  return render(
    <RunDetail
      organizationId="org-proof"
      automationSlug="docs-approval-proof"
      runId="run-proof"
    />,
  );
}

describe('RunDetail read recovery', () => {
  it.each([
    ['en', "Couldn't load this run.", 'Try again'],
    ['de', 'Dieser Lauf konnte nicht geladen werden.', 'Erneut versuchen'],
    ['fr', 'Impossible de charger cette exécution.', 'Réessayer'],
  ])('shows an actionable read failure in %s', async (locale, title, retry) => {
    const previousLocale = localStorage.getItem('user-locale');
    localStorage.setItem('user-locale', locale);
    await i18n.changeLanguage(locale);
    try {
      state.runError = new Error('Request failed with status 503');
      const { user } = renderRun();
      expect(screen.getByRole('alert')).toHaveTextContent(title);
      expect(screen.queryByText('Loading the run…')).toBeNull();
      expect(screen.queryByTestId('canvas')).toBeNull();
      await user.click(screen.getByRole('button', { name: retry }));
      expect(refetchRun).toHaveBeenCalledOnce();
    } finally {
      if (previousLocale === null) localStorage.removeItem('user-locale');
      else localStorage.setItem('user-locale', previousLocale);
      await i18n.changeLanguage('en');
    }
  });

  it('keeps pending reads distinct from failure', () => {
    state.runPending = true;
    renderRun();
    expect(screen.getByText('Loading the run…')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it.each([null, { data: { code: 'NOT_FOUND' } }])(
    'keeps missing runs distinct from failure: %s',
    (error) => {
      state.runMissing = error === null;
      state.runError = error === null ? undefined : error;
      renderRun();
      expect(
        screen.getByRole('heading', { name: 'Run not found' }),
      ).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    },
  );

  it.each([false, true])(
    'recovers retry focus without stealing moved focus: %s',
    async (moveFocus) => {
      state.runError = new Error('Request failed with status 503');
      const detail = () => (
        <RunDetail
          organizationId="org-proof"
          automationSlug="docs-approval-proof"
          runId="run-proof"
        />
      );
      const view = (
        <>
          <button>Route navigation</button>
          {detail()}
        </>
      );
      const { user, rerender } = render(view);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      state.runError = undefined;
      state.runPending = true;
      state.runFailureCount = 1;
      rerender(
        <>
          <button>Route navigation</button>
          {detail()}
        </>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't load this run.",
      );
      if (moveFocus)
        await user.click(
          screen.getByRole('button', { name: 'Route navigation' }),
        );
      state.runPending = false;
      state.runError = new Error('Request failed with status 503');
      rerender(
        <>
          <button>Route navigation</button>
          {detail()}
        </>,
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', {
            name: moveFocus ? 'Route navigation' : 'Try again',
          }),
        ).toHaveFocus(),
      );
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      state.runError = undefined;
      rerender(
        <>
          <button>Route navigation</button>
          {detail()}
        </>,
      );
      expect(screen.getByTestId('canvas')).toBeVisible();
      expect(screen.queryByText("Couldn't load this run.")).toBeNull();
    },
  );

  it('does not carry retry focus to another run', async () => {
    state.runError = new Error('Request failed with status 503');
    const { user, rerender } = renderRun();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    rerender(
      <RunDetail
        organizationId="org-proof"
        automationSlug="docs-approval-proof"
        runId="run-next"
      />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveFocus();
  });
});

const realRunClients: QueryClient[] = [];
const runQueryKey = [
  'backend',
  'org-proof',
  'automation_run',
  'detail',
  'run-proof',
];

afterEach(() => {
  for (const client of realRunClients) client.clear();
  realRunClients.length = 0;
  vi.unstubAllGlobals();
});

function renderRealRun() {
  state.realRunRead = true;
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  realRunClients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <button type="button">Route navigation</button>
      <RunDetail
        organizationId="org-proof"
        automationSlug="docs-approval-proof"
        runId="run-proof"
      />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function runResponse() {
  return Response.json({
    run: {
      id: 'run-proof',
      name: 'docs-approval-proof',
      version: 1,
      mode: 'live',
      status: 'success',
      startedAt: 1789363168936,
      finishedAt: 1789363170729,
      startedBy: 'user:user-me',
      input: {},
      output: null,
      effects: [],
      trace: [],
      detail: null,
    },
  });
}

function unavailableResponse() {
  return Response.json({ message: 'Service unavailable' }, { status: 503 });
}

describe('RunDetail real run read focus recovery', () => {
  it.each([
    ['en', 'Run not found'],
    ['de', 'Lauf nicht gefunden'],
    ['fr', 'Exécution introuvable'],
  ])(
    'keeps a settled missing run distinct during background rereads in %s',
    async (locale, missingTitle) => {
      const previousLocale = localStorage.getItem('user-locale');
      localStorage.setItem('user-locale', locale);
      await i18n.changeLanguage(locale);
      try {
        let refreshing = false;
        let finishRead: ((response: Response) => void) | undefined;
        const missingResponse = () =>
          Response.json({ error: 'run not found' }, { status: 404 });
        const fetchRun = vi.fn(() => {
          if (!refreshing) return Promise.resolve(missingResponse());
          return new Promise<Response>((resolve) => {
            finishRead = resolve;
          });
        });
        vi.stubGlobal('fetch', fetchRun);
        const { user, client } = renderRealRun();
        const missingHeading = await screen.findByRole(
          'heading',
          { name: missingTitle },
          { timeout: 30000 },
        );
        expect(fetchRun).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
        await user.click(
          screen.getByRole('button', { name: 'Route navigation' }),
        );
        refreshing = true;
        act(() => {
          void client.invalidateQueries({
            queryKey: ['backend', 'org-proof', 'automation_run'],
          });
        });
        await waitFor(() => expect(finishRead).toBeDefined(), {
          timeout: 30000,
        });
        expect(client.getQueryState(runQueryKey)?.status).toBe('pending');
        expect(client.getQueryState(runQueryKey)?.error).toBeNull();
        expect(screen.getByRole('heading', { name: missingTitle })).toBe(
          missingHeading,
        );
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('run not found')).toBeNull();
        expect(
          screen.getByRole('button', { name: 'Route navigation' }),
        ).toHaveFocus();
        await act(async () => {
          finishRead?.(missingResponse());
        });
        await waitFor(
          () => expect(client.getQueryState(runQueryKey)?.status).toBe('error'),
          { timeout: 30000 },
        );
        expect(screen.getByRole('heading', { name: missingTitle })).toBe(
          missingHeading,
        );
        expect(screen.queryByRole('alert')).toBeNull();
        finishRead = undefined;
        act(() => {
          void client.invalidateQueries({
            queryKey: ['backend', 'org-proof', 'automation_run'],
          });
        });
        await waitFor(() => expect(finishRead).toBeDefined(), {
          timeout: 30000,
        });
        expect(screen.getByRole('heading', { name: missingTitle })).toBe(
          missingHeading,
        );
        expect(screen.queryByRole('alert')).toBeNull();
        await act(async () => {
          finishRead?.(runResponse());
        });
        await screen.findByTestId('canvas', {}, { timeout: 30000 });
        expect(
          screen.queryByRole('heading', { name: missingTitle }),
        ).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(
          screen.getByRole('button', { name: 'Route navigation' }),
        ).toHaveFocus();
      } finally {
        if (previousLocale === null) localStorage.removeItem('user-locale');
        else localStorage.setItem('user-locale', previousLocale);
        await i18n.changeLanguage('en');
      }
    },
    60000,
  );

  it.each(['retry', 'outside'] as const)(
    'retains keyboard Retry through repeated failure and respects %s focus on recovery',
    async (recoveryFocus) => {
      let deferRead = false;
      let finishRead: ((response: Response) => void) | undefined;
      const fetchRun = vi.fn((url: string) => {
        expect(new URL(url, window.location.origin).pathname).toBe(
          '/api/app/automations/runs/run-proof',
        );
        if (!deferRead) return Promise.resolve(unavailableResponse());
        return new Promise<Response>((resolve) => {
          finishRead = resolve;
        });
      });
      vi.stubGlobal('fetch', fetchRun);
      const { user } = renderRealRun();
      const retryButton = await screen.findByRole(
        'button',
        { name: 'Try again' },
        { timeout: 30000 },
      );
      expect(fetchRun).toHaveBeenCalledTimes(4);
      await user.click(
        screen.getByRole('button', { name: 'Route navigation' }),
      );
      await user.tab();
      expect(retryButton).toHaveFocus();
      deferRead = true;
      await user.keyboard('{Enter}');
      await waitFor(() => expect(finishRead).toBeDefined(), { timeout: 30000 });
      expect(retryButton).toHaveFocus();
      expect(retryButton).not.toBeDisabled();
      expect(retryButton).toHaveAttribute('aria-busy', 'true');
      expect(retryButton).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByText('Loading the run…')).toBeNull();
      const requests = fetchRun.mock.calls.length;
      await user.keyboard('{Enter}');
      expect(fetchRun).toHaveBeenCalledTimes(requests);
      deferRead = false;
      await act(async () => {
        finishRead?.(unavailableResponse());
      });
      await waitFor(
        () => expect(retryButton).not.toHaveAttribute('aria-busy'),
        { timeout: 30000 },
      );
      expect(screen.getByRole('button', { name: 'Try again' })).toBe(
        retryButton,
      );
      expect(retryButton).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
      finishRead = undefined;
      deferRead = true;
      await user.keyboard('{Enter}');
      await waitFor(() => expect(finishRead).toBeDefined(), { timeout: 30000 });
      expect(retryButton).toHaveFocus();
      if (recoveryFocus === 'outside')
        await user.click(
          screen.getByRole('button', { name: 'Route navigation' }),
        );
      await act(async () => {
        finishRead?.(runResponse());
      });
      await screen.findByTestId('canvas', {}, { timeout: 30000 });
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      await waitFor(() =>
        expect(
          screen.getByRole(recoveryFocus === 'retry' ? 'region' : 'button', {
            name: recoveryFocus === 'retry' ? 'Run' : 'Route navigation',
          }),
        ).toHaveFocus(),
      );
      expect(document.activeElement).not.toBe(document.body);
    },
    60000,
  );

  it.each(['success', 'failure'] as const)(
    'retains focused Retry through background invalidation and %s',
    async (outcome) => {
      let refreshing = false;
      let finishRead: ((response: Response) => void) | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          if (!refreshing) return Promise.resolve(unavailableResponse());
          return new Promise<Response>((resolve) => {
            finishRead = resolve;
          });
        }),
      );
      const { user, client } = renderRealRun();
      const retryButton = await screen.findByRole(
        'button',
        { name: 'Try again' },
        { timeout: 30000 },
      );
      await user.click(
        screen.getByRole('button', { name: 'Route navigation' }),
      );
      await user.tab();
      expect(retryButton).toHaveFocus();
      refreshing = true;
      act(() => {
        void client.invalidateQueries({
          queryKey: ['backend', 'org-proof', 'automation_run'],
        });
      });
      await waitFor(() => expect(finishRead).toBeDefined(), { timeout: 30000 });
      expect(retryButton).toHaveFocus();
      expect(retryButton).not.toBeDisabled();
      expect(retryButton).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('Loading the run…')).toBeNull();
      if (outcome === 'failure') refreshing = false;
      await act(async () => {
        finishRead?.(
          outcome === 'success' ? runResponse() : unavailableResponse(),
        );
      });
      if (outcome === 'success') {
        await screen.findByTestId('canvas', {}, { timeout: 30000 });
        await waitFor(() =>
          expect(screen.getByRole('region', { name: 'Run' })).toHaveFocus(),
        );
      } else {
        await waitFor(
          () => expect(retryButton).not.toHaveAttribute('aria-busy'),
          { timeout: 30000 },
        );
        expect(screen.getByRole('button', { name: 'Try again' })).toBe(
          retryButton,
        );
        expect(retryButton).toHaveFocus();
      }
      expect(document.activeElement).not.toBe(document.body);
    },
    60000,
  );

  it('preserves cached run details and chosen focus after a failed background read', async () => {
    let failRefresh = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(failRefresh ? unavailableResponse() : runResponse()),
      ),
    );
    const { user, client } = renderRealRun();
    const canvas = await screen.findByTestId('canvas', {}, { timeout: 30000 });
    await user.click(screen.getByRole('button', { name: 'Route navigation' }));
    failRefresh = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: runQueryKey });
    });
    expect(client.getQueryState(runQueryKey)?.status).toBe('error');
    expect(screen.getByTestId('canvas')).toBe(canvas);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Route navigation' }),
    ).toHaveFocus();
  }, 60000);
});

describe('RunDetail native run state', () => {
  it('shows a UUID approval and lets the reader reject the exact operation', async () => {
    const { user } = renderRun();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(readApproval).toHaveBeenCalledWith(
      'org-proof',
      '250a93eb-9413-4699-94e8-ee3164e5e545',
    );
    expect(resolveApproval).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(resolveApproval).toHaveBeenCalledWith({
      approvalId: '250a93eb-9413-4699-94e8-ee3164e5e545',
      status: 'rejected',
    });
  });

  it('does not invent a finish date for a waiting run with a null timestamp', () => {
    renderRun();
    expect(screen.queryByText(/^Finished /)).toBeNull();
    expect(screen.queryByText(/1970/)).toBeNull();
  });

  it('shows the recorded finish date and no approval controls once finished', () => {
    state.status = 'failed';
    state.finishedAt = 1789363170729;
    renderRun();
    expect(screen.getByText(/^Finished /)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('renders a null run detail without an empty waiting alert', () => {
    state.detail = null;
    state.waitingFor = undefined;
    renderRun();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * The header names the starter and the park in words — the record's
 * `user:<id>` door and `repeat:<node>` park used to print verbatim
 * (2026-09-26 evaluation, D-01 and D-08).
 */
describe('RunDetail starter and reason', () => {
  it('names the reader as the starter, never the raw door', () => {
    renderRun();
    expect(screen.getByText('Started by you')).toBeVisible();
    expect(screen.queryByText(/user:user-me/)).toBeNull();
  });

  it('names another member, and the trigger kind of a trigger run', () => {
    state.startedBy = 'api-key:user-dana';
    const first = renderRun();
    expect(screen.getByText('Started by Dana K. (API)')).toBeVisible();
    first.unmount();
    state.startedBy = 'trigger:t-1';
    state.startedVia = 'webhook';
    renderRun();
    expect(screen.getByText('Started by a webhook')).toBeVisible();
    expect(screen.queryByText(/trigger:t-1/)).toBeNull();
  });

  it('says a polling park in words instead of the raw repeat detail', () => {
    state.detail = 'repeat:tick';
    state.waitingFor = 'repeat';
    renderRun();
    expect(screen.getByRole('alert')).toHaveTextContent('Polling — step tick');
    expect(screen.queryByText('repeat:tick')).toBeNull();
  });

  it('keeps the failure sentence of a failed run', () => {
    state.status = 'failed';
    state.finishedAt = 1789363170729;
    state.detail = 'send: no usable credential for imap-smtp';
    state.waitingFor = undefined;
    renderRun();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'send: no usable credential for imap-smtp',
    );
  });

  it('shows no reason on a stopped run whose park is history', () => {
    state.status = 'cancelled';
    state.finishedAt = 1789363170729;
    state.detail = 'repeat:tick';
    state.waitingFor = undefined;
    renderRun();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/repeat/)).toBeNull();
  });
});

/**
 * A stop is final and withdraws whatever the run waits on, so it asks first
 * (2026-09-26 evaluation, D-07).
 */
describe('RunDetail stop', () => {
  it('asks before stopping and stops only on confirm', async () => {
    const { user } = renderRun();
    await user.click(screen.getByRole('button', { name: 'Stop the run' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Stop this run?');
    expect(cancelRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelRun).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Stop the run' }));
    const confirm = (
      await screen.findAllByRole('button', { name: 'Stop the run' })
    ).at(-1);
    if (confirm === undefined) throw new Error('no confirm button');
    await user.click(confirm);
    expect(cancelRun).toHaveBeenCalledWith(
      { organizationId: 'org-proof', runId: 'run-proof' },
      expect.any(Object),
    );
  });

  // The run page keeps RunDetail mounted when it moves to another run on the
  // same route (a continuation, back/forward). A refused stop belongs to the
  // run it was asked for, never to the next one.
  it('keeps a refused stop with the run it was asked for', async () => {
    cancelRun.mockImplementationOnce(
      (_args: unknown, options: { onError?: (error: Error) => void }) => {
        options.onError?.(new Error('run-proof could not be stopped'));
      },
    );
    const { user, rerender } = renderRun();
    await user.click(screen.getByRole('button', { name: 'Stop the run' }));
    const confirm = (
      await screen.findAllByRole('button', { name: 'Stop the run' })
    ).at(-1);
    if (confirm === undefined) throw new Error('no confirm button');
    await user.click(confirm);
    expect(
      await screen.findByText('run-proof could not be stopped'),
    ).toBeVisible();

    rerender(
      <RunDetail
        organizationId="org-proof"
        automationSlug="docs-approval-proof"
        runId="run-next"
      />,
    );

    expect(screen.queryByText('run-proof could not be stopped')).toBeNull();
  });

  it('offers no stop on a finished run', () => {
    state.status = 'cancelled';
    state.finishedAt = 1789363170729;
    state.detail = null;
    state.waitingFor = undefined;
    renderRun();
    expect(screen.queryByRole('button', { name: 'Stop the run' })).toBeNull();
  });
});

/**
 * A deleted automation keeps its runs but has no version document left, so
 * the run page drew an empty canvas — a blank page over retained history
 * (2026-09-26 evaluation, D-14). The canvas now comes from the run's trace.
 */
describe('RunDetail without a version document', () => {
  it('draws the canvas from the trace when the automation was deleted', () => {
    state.status = 'success';
    state.finishedAt = 1789363170729;
    state.detail = null;
    state.waitingFor = undefined;
    state.trace = [
      { node: 'draft', type: 'llm', status: 'ok', output: 'Hello' },
      { node: 'send', type: 'imap-smtp.send', status: 'ok' },
    ];
    state.versionError = {
      data: { code: 'AUTOMATION_DELETED', deletedAt: 1789363170729 },
    };
    renderRun();
    const canvas = screen.getByTestId('canvas');
    expect(canvas).toHaveTextContent('draft (llm): ok');
    expect(canvas).toHaveTextContent('send (imap-smtp.send): ok');
    expect(screen.getByText(/^Started by/)).toBeVisible();
  });

  it('draws each repeated node once', () => {
    state.status = 'success';
    state.finishedAt = 1789363170729;
    state.detail = null;
    state.waitingFor = undefined;
    state.trace = [
      { node: 'draft', type: 'llm', status: 'ok' },
      { node: 'check', type: 'transform', status: 'ok' },
      { node: 'draft', type: 'llm', status: 'ok' },
    ];
    state.versionError = {
      data: { code: 'AUTOMATION_DELETED', deletedAt: 1789363170729 },
    };
    renderRun();
    const canvas = screen.getByTestId('canvas');
    expect(canvas.querySelectorAll('li')).toHaveLength(2);
    expect(canvas).toHaveTextContent('draft (llm): ok');
    expect(canvas).toHaveTextContent('check (transform): ok');
  });

  // The fallback used to kick in whenever the document was missing — while
  // the version was still LOADING too — so every run page first drew a
  // throwaway trace canvas and then jumped to the real one.
  it('shows the loading state, not the trace canvas, while the version loads', () => {
    state.trace = [{ node: 'draft', type: 'llm', status: 'ok' }];
    state.versionPending = true;
    renderRun();
    expect(screen.queryByTestId('canvas')).toBeNull();
    expect(screen.getByText('Loading the run…')).toBeInTheDocument();
  });

  it('does not draw the trace canvas on a transient version read failure', () => {
    state.trace = [{ node: 'draft', type: 'llm', status: 'ok' }];
    state.versionError = new Error('network down');
    renderRun();
    expect(screen.getByTestId('canvas')).not.toHaveTextContent('draft');
  });

  it('prefers the version document when it exists', () => {
    state.trace = [{ node: 'draft', type: 'llm', status: 'ok' }];
    state.versionDocument = {
      name: 'docs-approval-proof',
      nodes: [
        { id: 'draft', type: 'llm' },
        { id: 'later', type: 'transform' },
      ],
    };
    renderRun();
    const canvas = screen.getByTestId('canvas');
    expect(canvas).toHaveTextContent('later (transform): pending');
  });
});
