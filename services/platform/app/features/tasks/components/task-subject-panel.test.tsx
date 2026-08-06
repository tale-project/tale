// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';
import { render, screen } from '@/tests/utils/render';

import type { ResolvedTaskSubjectContract } from '../hooks/use-task-subject-contract';

// The panel's whole job is to answer, on the first screen of an
// automation-owned task: WHO owns it, WHAT it is, WHAT NOW, WHAT TO PRESS.
// Pinned here against the two states a reader meets before anything runs —
// waiting for input and ready — because the failure this locks out is a state
// that TALKS about starting while offering nothing to start.

const mocks = vi.hoisted(() => ({
  run: null as unknown,
  documents: [] as Array<{ folderId?: string }>,
  start: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return { data: undefined };
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      return { data: mocks.run };
    }
    return { data: mocks.documents };
  },
}));

vi.mock('@/app/hooks/use-convex-action', async () => {
  const { api } = await import('@/convex/_generated/api');
  return {
    useConvexAction: (action: unknown) => ({
      mutateAsync:
        action === api.tasks.public_actions.cancelTaskWorkflow
          ? mocks.cancel
          : mocks.start,
    }),
  };
});

vi.mock('../hooks/mutations', () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn() }),
  useAddTaskComment: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

// The reviewer name line rides the actor directory (org members via router
// params) — stub the seam; these tests exercise the subject verbs, not names.
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (_type: string, id: string) => ({
      type: 'user',
      id,
      name: id,
      isAgent: false,
    }),
  }),
}));

import { TaskSubjectPanel } from './task-subject-panel';

const FOLDER = 'folder_2026q2';

const contract: TaskSubjectContract = {
  workflow: 'document-verify-desk',
  externalSystem: 'acme',
  input: { kind: 'folder', naming: String.raw`^\d{4}Q[1-4]$` },
  start: { when: 'hasFiles && status == backlog' },
  review: { requestChanges: true },
};

function ownedBy(
  overrides: Partial<ResolvedTaskSubjectContract> = {},
): ResolvedTaskSubjectContract {
  return {
    automationSlug: 'document-verify-desk',
    displayName: 'Document verification desk',
    displayDescription:
      'Verifies one batch of incoming documents for completeness and consistency.',
    contract,
    settings: null,
    ...overrides,
  };
}

function renderPanel(resolved = ownedBy()) {
  return render(
    <TaskSubjectPanel
      organizationId="org_1"
      task={{
        _id: 'task_1' as Id<'tasks'>,
        projectId: 'project_1' as Id<'projects'>,
        status: 'backlog',
        externalId: FOLDER,
      }}
      ownedBy={resolved}
      canEdit
    />,
  );
}

describe('TaskSubjectPanel', () => {
  beforeEach(() => {
    mocks.run = null;
    mocks.documents = [];
    mocks.start.mockReset();
    mocks.start.mockResolvedValue({ started: true });
  });

  it('names the automation and shows the automation s own description', () => {
    mocks.documents = [{ folderId: FOLDER }];
    renderPanel();

    expect(
      screen.getByRole('heading', { name: 'Document verification desk' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Verifies one batch of incoming documents for completeness and consistency.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no description line when the pack declared none', () => {
    mocks.documents = [{ folderId: FOLDER }];
    const { container } = renderPanel(
      ownedBy({ displayDescription: undefined }),
    );

    expect(
      screen.getByRole('heading', { name: 'Document verification desk' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.line-clamp-2')).toBeNull();
  });

  // The regression this file exists for: the waiting-for-input copy tells the
  // reader to upload "then press Start", so Start must be ON SCREEN — inert,
  // explained, and impossible to fire — rather than absent until files land.
  it('keeps Start on screen while input is missing, inert and explained', async () => {
    const { user } = renderPanel();

    expect(
      screen.getByText(
        'Waiting for input files — upload them below, then press Start.',
      ),
    ).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toHaveAttribute('aria-disabled', 'true');
    // Soft-disabled, so it stays reachable — a natively disabled button could
    // never surface its reason to a keyboard user.
    expect(start).not.toHaveAttribute('disabled');

    await user.click(start);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('starts the workflow once the bound folder has files', async () => {
    mocks.documents = [{ folderId: FOLDER }];
    const { user } = renderPanel();

    expect(
      screen.getByText(
        'Ready to start — Document verification desk takes it from here.',
      ),
    ).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).not.toHaveAttribute('aria-disabled');

    await user.click(start);
    expect(mocks.start).toHaveBeenCalledWith({
      organizationId: 'org_1',
      taskId: 'task_1',
      workflowSlug: 'document-verify-desk',
    });
  });

  it('ignores files that live outside the task s own folder', () => {
    mocks.documents = [{ folderId: 'folder_other' }];
    renderPanel();

    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
