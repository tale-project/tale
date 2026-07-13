// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubjectInputPanel } from './subject-input-panel';

// Drive the input-request query by hand; echo i18n keys so assertions read clearly.
let request: { executionId: string; questions: string[] } | null | undefined;
const postComment = vi.fn();
const rerun = vi.fn();
const toastSpy = vi.fn();

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: request }),
}));
vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: postComment, isPending: false }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: rerun, isPending: false }),
}));
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (arg: unknown) => toastSpy(arg),
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/convex/_generated/api', () => ({
  api: {
    workflow_executions: {
      queries: { getSubjectInputRequest: 'q' },
      actions: { rerunExecution: 'a' },
    },
    tasks: { mutations: { addTaskComment: 'm' } },
  },
}));
vi.mock('../../runtime/automation-runtime', () => ({
  useAutomationRuntime: () => ({ organizationId: 'org' }),
}));
vi.mock('@/app/components/ui/forms/textarea', () => ({
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

function renderPanel() {
  return render(<SubjectInputPanel subjectType="task" subjectId="t1" />);
}

beforeEach(() => {
  postComment.mockReset().mockResolvedValue({
    messageId: 'm1',
    threadId: 'th1',
    unresolvedMentionTokens: [],
  });
  rerun.mockReset().mockResolvedValue({ started: true, executionId: 'e2' });
  toastSpy.mockReset();
  request = undefined;
});

describe('SubjectInputPanel', () => {
  it('renders nothing when there is no pending input request', () => {
    request = null;
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces the run’s question(s) and the submit action inline when input is pending', () => {
    request = {
      executionId: 'e1',
      questions: ['RE-2023-4471: what is the exact Q1 2026 booking date?'],
    };
    renderPanel();
    expect(
      screen.getByText('RE-2023-4471: what is the exact Q1 2026 booking date?'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'runs.input.submit' }),
    ).toBeInTheDocument();
  });

  it('posts the answer, then re-runs the parked execution, then clears on success', async () => {
    request = { executionId: 'e1', questions: ['booking date?'] };
    renderPanel();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '2026-01-15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'runs.input.submit' }));

    await waitFor(() => expect(rerun).toHaveBeenCalled());
    expect(postComment).toHaveBeenCalledWith({
      taskId: 't1',
      body: '2026-01-15',
    });
    expect(rerun).toHaveBeenCalledWith({ executionId: 'e1' });
    // The reply must be committed before the fresh run reads the thread.
    expect(postComment.mock.invocationCallOrder[0]).toBeLessThan(
      rerun.mock.invocationCallOrder[0],
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  });

  it('keeps submit disabled until the operator types a non-empty answer', () => {
    request = { executionId: 'e1', questions: ['booking date?'] };
    renderPanel();
    const button = screen.getByRole('button', { name: 'runs.input.submit' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '2026-01-15' },
    });
    expect(button).toBeEnabled();
  });
});
