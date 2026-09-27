import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { state, resolveApproval, readApproval } = vi.hoisted(() => ({
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
  },
  resolveApproval: vi.fn(),
  readApproval: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationRun: () => ({
    data: {
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
  }),
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
}));
const cancelRun = vi.hoisted(() => vi.fn());
vi.mock('../hooks/mutations', () => ({
  useCancelAutomationRun: () => ({ mutate: cancelRun, isPending: false }),
  useResolveRunApproval: () => ({ mutate: resolveApproval, isPending: false }),
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
    expect(resolveApproval).toHaveBeenCalledWith(
      {
        approvalId: '250a93eb-9413-4699-94e8-ee3164e5e545',
        status: 'rejected',
      },
      expect.any(Object),
    );
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
