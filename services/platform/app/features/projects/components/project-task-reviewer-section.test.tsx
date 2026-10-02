// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { EditorGroup } from '@tale/ui/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { ProjectTaskReviewerSection } from './project-task-reviewer-section';

const mocks = vi.hoisted(() => ({
  project: {
    canEdit: true,
    defaultTaskReviewerAgentId: undefined as string | undefined,
    archivedAt: undefined as number | undefined,
  },
  save: vi.fn(),
}));
vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: mocks.project }),
  useProjectAgents: () => ({
    agents: [
      { _id: 'reviewer-1', name: 'Review agent', tools: ['task_review'] },
      { _id: 'reviewer-2', name: 'Other agent', tools: [] },
    ],
    isLoading: false,
  }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetProjectTaskReviewer: () => ({ mutateAsync: mocks.save }),
}));
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
