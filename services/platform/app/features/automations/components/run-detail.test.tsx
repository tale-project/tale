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
      trace: null,
      effects: [],
      ...state,
    },
  }),
  useAutomation: () => ({
    data: { document: { name: 'docs-approval-proof', nodes: [] } },
  }),
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
vi.mock('../hooks/mutations', () => ({
  useCancelAutomationRun: () => ({ mutate: vi.fn(), isPending: false }),
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
vi.mock('./automation-canvas', () => ({ AutomationCanvas: () => null }));
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
