// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskParentLink } from './task-parent-link';

const mocks = vi.hoisted(() => ({
  parent: null as null | { _id: string; number: number; title: string },
}));

vi.mock('../hooks/queries', () => ({
  useTask: () => ({ task: mocks.parent }),
}));

beforeEach(() => {
  mocks.parent = { _id: 'task_parent', number: 12, title: 'Launch checklist' };
});

describe('TaskParentLink', () => {
  it('names the parent by its identifier and opens it', async () => {
    const onOpenTask = vi.fn();
    const { user } = render(
      <TaskParentLink
        parentTaskId="task_parent"
        projectKey="TAL"
        onOpenTask={onOpenTask}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Part of TAL-12' }));
    expect(onOpenTask).toHaveBeenCalledWith('task_parent');
  });

  it('falls back to the parent title without a project key', () => {
    render(
      <TaskParentLink
        parentTaskId="task_parent"
        projectKey={null}
        onOpenTask={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Part of Launch checklist' }),
    ).toBeInTheDocument();
  });

  it('renders nothing until the parent has loaded', () => {
    mocks.parent = null;
    const { container } = render(
      <TaskParentLink parentTaskId="task_parent" projectKey="TAL" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
