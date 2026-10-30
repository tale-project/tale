// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { EditorGroup } from '@tale/ui/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { ProjectTaskReviewerSection } from './project-task-reviewer-section';

const mocks = vi.hoisted(() => ({
  project: {
    canEdit: true,
    defaultTaskReviewerAgentId: undefined as string | undefined,
    archivedAt: undefined as number | undefined,
  },
  /** How `useProjectAgents` reports its read (`readStateOf`). */
  agentsRead: {
    agents: [] as { _id: string; name: string; tools: string[] }[],
    hasAnswer: false,
    isLoading: false,
    unavailable: false,
    stale: false,
    retrying: false,
    failureCount: 0,
  },
  retryAgents: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: mocks.project }),
  useProjectAgents: () => ({ ...mocks.agentsRead, retry: mocks.retryAgents }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetProjectTaskReviewer: () => ({ mutateAsync: mocks.save }),
}));

const AGENTS = [
  { _id: 'reviewer-1', name: 'Review agent', tools: ['task_review'] },
  { _id: 'reviewer-2', name: 'Other agent', tools: [] },
];
/** A read that answered with these agents. */
function answered(agents = AGENTS): typeof mocks.agentsRead {
  return {
    agents,
    hasAnswer: true,
    isLoading: false,
    unavailable: false,
    stale: false,
    retrying: false,
    failureCount: 0,
  };
}
/** The first read, still waiting for its answer. */
const PENDING = { ...answered([]), hasAnswer: false, isLoading: true };
/** A read that failed before it ever answered: no agents are known. */
const FAILED = {
  ...answered([]),
  hasAnswer: false,
  unavailable: true,
  failureCount: 1,
};

const UNAVAILABLE =
  'The selected reviewer agent is unavailable. Choose another reviewer.';
const LOAD_FAILED = "Couldn't load this project's agents.";

function Subject() {
  return (
    <EditorGroup>
      <ProjectTaskReviewerSection projectId="project-1" />
    </EditorGroup>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project = {
    canEdit: true,
    defaultTaskReviewerAgentId: undefined,
    archivedAt: undefined,
  };
  mocks.agentsRead = answered();
  mocks.save.mockResolvedValue(null);
});

describe('ProjectTaskReviewerSection', () => {
  it.each(['during', 'after'] as const)(
    'uses the acknowledged default for a second save when its echo arrives %s the first save',
    async (echo) => {
      let settle: (() => void) | undefined;
      mocks.save.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      );
      const view = render(<Subject />);
      const button = screen.getByRole('button', { name: 'Default reviewer' });
      await view.user.click(button);
      await view.user.click(
        screen.getByRole('option', { name: /^Review agent/ }),
      );
      const form = button.closest('form');
      if (!form) throw new Error('reviewer form missing');
      fireEvent.submit(form);
      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      expect(button).toBeDisabled();
      const echoSavedValue = () => {
        mocks.project = {
          ...mocks.project,
          defaultTaskReviewerAgentId: 'reviewer-1',
        };
        view.rerender(<Subject />);
      };
      if (echo === 'during') echoSavedValue();
      await act(async () => {
        settle?.();
      });
      if (echo === 'after') echoSavedValue();
      expect(button).toBeEnabled();
      await view.user.click(button);
      await view.user.click(
        screen.getByRole('option', { name: /^Other agent/ }),
      );
      fireEvent.submit(form);
      await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
      expect(mocks.save).toHaveBeenLastCalledWith({
        projectId: 'project-1',
        reviewer: { kind: 'agent', agentId: 'reviewer-2' },
        expected: { kind: 'agent', agentId: 'reviewer-1' },
      });
    },
  );

  it('saves the chosen agent and the baseline seen when the draft began', async () => {
    const view = render(<Subject />);
    const button = screen.getByRole('button', { name: 'Default reviewer' });
    expect(button).toHaveAccessibleDescription(
      'Applies when a new review starts. Reviews already waiting keep their recorded reviewer.',
    );
    await view.user.click(button);
    await view.user.click(
      screen.getByRole('option', { name: /^Review agent/ }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    // Another session changes the server value; this dirty draft must retain
    // the baseline that made its choice reviewable, not overwrite the new one.
    mocks.project = {
      ...mocks.project,
      defaultTaskReviewerAgentId: 'reviewer-2',
    };
    view.rerender(<Subject />);
    const form = button.closest('form');
    if (!form) throw new Error('reviewer form missing');
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        projectId: 'project-1',
        reviewer: { kind: 'agent', agentId: 'reviewer-1' },
        expected: { kind: 'human_default' },
      }),
    );
  });

  it('shows missing permission without granting access when an agent is selected', async () => {
    const { user } = render(<Subject />);
    await user.click(screen.getByRole('button', { name: 'Default reviewer' }));
    await user.click(screen.getByRole('option', { name: /^Other agent/ }));
    expect(
      screen.getByText(
        'This agent needs the task review permission before it can decide.',
      ),
    ).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps a saved agent when the agent list fails to load, and reads it again on Try again', async () => {
    mocks.project = {
      ...mocks.project,
      defaultTaskReviewerAgentId: 'reviewer-1',
    };
    mocks.agentsRead = FAILED;
    const view = render(<Subject />);
    const picker = screen.getByRole('button', { name: 'Default reviewer' });
    // A list that never answered proves nothing about the agent: no verdict,
    // no invitation to replace it, and no picker over options it lacks.
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    expect(picker).toHaveTextContent('Agent not loaded');
    expect(picker).toBeDisabled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(LOAD_FAILED);
    await view.user.click(
      within(alert).getByRole('button', { name: 'Try again' }),
    );
    expect(mocks.retryAgents).toHaveBeenCalledTimes(1);

    // The retry runs: the notice stays, busy, and still no verdict.
    mocks.agentsRead = { ...FAILED, isLoading: true, retrying: true };
    view.rerender(<Subject />);
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();

    // It answers: the saved agent is named and can be changed again.
    mocks.agentsRead = answered();
    view.rerender(<Subject />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(picker).toHaveTextContent('Review agent');
    expect(picker).toBeEnabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('names a failed agent list under a person reviewer too', () => {
    mocks.agentsRead = FAILED;
    render(<Subject />);
    const picker = screen.getByRole('button', { name: 'Default reviewer' });
    expect(picker).toHaveTextContent('Person');
    expect(picker).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED);
  });

  it('gives no verdict on a saved agent while the agent list loads', () => {
    mocks.project = {
      ...mocks.project,
      defaultTaskReviewerAgentId: 'reviewer-1',
    };
    mocks.agentsRead = PENDING;
    render(<Subject />);
    const picker = screen.getByRole('button', { name: 'Default reviewer' });
    expect(picker).toHaveTextContent('Loading...');
    expect(picker).toBeDisabled();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a saved agent is unavailable once the answered list lacks it', () => {
    mocks.project = {
      ...mocks.project,
      defaultTaskReviewerAgentId: 'reviewer-removed',
    };
    render(<Subject />);
    const picker = screen.getByRole('button', { name: 'Default reviewer' });
    expect(picker).toHaveTextContent(UNAVAILABLE);
    expect(picker).toBeEnabled();
    // The value and the caption under it.
    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['viewer', 'archived'] as const)(
    'keeps %s settings read-only',
    (mode) => {
      mocks.project = {
        canEdit: mode !== 'viewer',
        defaultTaskReviewerAgentId: 'reviewer-1',
        archivedAt: mode === 'archived' ? 1 : undefined,
      };
      render(<Subject />);
      expect(
        screen.getByRole('button', { name: 'Default reviewer' }),
      ).toBeDisabled();
      expect(screen.getByText('Review agent')).toBeInTheDocument();
    },
  );
});
