import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskRunActions } from './task-run-actions';

// Seams: the resolved contract, the latest subject run, and the project's
// documents (the hasFiles fact). The when-predicate and gating logic stay real.
const contractState: { current: unknown } = { current: null };
vi.mock('../hooks/use-task-subject-contract', () => ({
  useTaskSubjectContract: () => contractState.current,
}));

const runState: { current: { status: string } | null } = { current: null };
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: runState.current, isLoading: false }),
}));

const docsState: { current: Array<{ folderId?: string }> } = { current: [] };
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectDocuments: () => ({
    documents: docsState.current,
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const CONTRACT = {
  automationSlug: 'vat-return-desk',
  name: 'Swiss VAT return desk',
  contract: {
    workflow: 'vat-return-desk',
    externalSystem: 'vatplus',
    input: { kind: 'folder' },
    start: {
      when: 'hasFiles && status == backlog || hasFiles && status == todo',
    },
    review: { requestChanges: true },
  },
};

const TASK = {
  _id: 'task_1',
  projectId: 'proj_1',
  status: 'todo',
  createdBy: 'vat-return-desk',
  createdByType: 'app',
  externalSystem: 'vatplus',
  externalId: 'folder_1',
} as never;

function renderActions(taskOverrides: Record<string, unknown> = {}) {
  return render(
    <TaskRunActions
      organizationId="org_1"
      task={{ ...(TASK as object), ...taskOverrides } as never}
    />,
  );
}

beforeEach(() => {
  contractState.current = CONTRACT;
  runState.current = null;
  docsState.current = [];
});

describe('TaskRunActions', () => {
  it('renders nothing for tasks no automation owns', () => {
    contractState.current = null;
    const { container } = renderActions();
    expect(container).toBeEmptyDOMElement();
  });

  it('hides Start until the bound folder has files', () => {
    docsState.current = [{ folderId: 'other_folder' }];
    const { container } = renderActions();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Start when the when-predicate holds', () => {
    docsState.current = [{ folderId: 'folder_1' }];
    renderActions();
    expect(
      screen.getByRole('button', { name: 'list.start' }),
    ).toBeInTheDocument();
  });

  it('offers Request changes at in_review instead of Start', () => {
    docsState.current = [{ folderId: 'folder_1' }];
    renderActions({ status: 'in_review' });
    expect(
      screen.getByRole('button', { name: 'list.requestChanges' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'list.start' })).toBeNull();
  });

  it('offers only Cancel while a run is active', () => {
    docsState.current = [{ folderId: 'folder_1' }];
    runState.current = { status: 'running' };
    renderActions();
    expect(
      screen.getByRole('button', { name: 'list.cancel' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'list.start' })).toBeNull();
  });
});
