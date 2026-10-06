import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useRef, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { ActorDirectoryBoundary } from '../hooks/task-actor-directory';
import { TaskLogViewport } from '../hooks/use-task-log-window';
import type { TaskActorPreview } from '../utils/task-actor-preview';
import type { TaskActivityRow, TaskAgentRunRow } from '../utils/task-timeline';
import { TaskComments, type TaskCommentData } from './task-comments';
import { TaskConversation } from './task-conversation';
import { TaskTimeline } from './task-timeline';

import '@/app/globals.css';

const state = vi.hoisted(() => ({
  comments: [] as TaskCommentData[],
  activity: [] as TaskActivityRow[],
  activityListeners: new Set<() => void>(),
  runs: [] as TaskAgentRunRow[],
  hasEarlier: false,
  loadEarlier: vi.fn(),
  directoryRead: vi.fn(),
  edit: vi.fn(),
}));
const directory = {
  members: [{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }],
  agents: [],
  automations: [],
  subjectEntries: [],
  assignableMembers: [],
  assignableAgents: [],
  resolveActor: (_type: string, id: string) => ({
    name: id === 'agent-1' ? 'Reporter' : 'Ada',
  }),
  resolveActorPreview: (_type: string, id: string): TaskActorPreview | null =>
    id === 'agent-1'
      ? {
          kind: 'workflow',
          name: 'Reporter',
          description: 'Reporter preview remains open.',
          viewTo: '/dashboard/$id/automations/$automationSlug',
          viewParams: { id: 'org-1', automationSlug: 'reporter' },
        }
      : null,
  resolveAssigneeId: (id: string) => id,
  resolveAgentRunPreview: (): TaskActorPreview => ({
    kind: 'agent',
    name: 'Reporter',
    viewTo: '/dashboard/$id',
    viewParams: { id: 'org-1' },
  }),
  resolveWorkflowRunPreview: () => null,
};
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => {
    state.directoryRead();
    return directory;
  },
  useAssignableActors: () => {
    state.directoryRead();
    return directory;
  },
}));
vi.mock('../hooks/queries', () => ({
  useTaskDiscussion: () => ({
    comments: state.comments,
    hasEarlier: state.hasEarlier,
    isLoadingEarlier: false,
    loadEarlier: state.loadEarlier,
  }),
  useTaskActivity: () => ({
    activity: useSyncExternalStore(
      (listener) => {
        state.activityListeners.add(listener);
        return () => state.activityListeners.delete(listener);
      },
      () => state.activity,
    ),
  }),
  useTaskAgentRuns: () => ({ runs: state.runs }),
}));
vi.mock('../hooks/mutations', () => ({
  useEditTaskComment: () => ({ mutateAsync: state.edit, isPending: false }),
  useDeleteTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../lib/mention-actor-options', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mention-actor-options')>()),
  useMentionActorOptions: () => [
    { type: 'user', id: 'user-2', name: 'Grace Hopper', handle: 'grace' },
  ],
}));
vi.mock('./mention-trigger-chips', () => ({ MentionTriggerChips: () => null }));
vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-1' } }),
}));
vi.mock('@/app/features/automations/hooks/use-can-use-automations', () => ({
  useCanUseAutomations: () => false,
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));
vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Oct 5, 2026',
    formatDateHeader: () => 'Today',
  }),
}));
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {},
}));

function Harness({
  mode,
  canComment = false,
  leadHeight = 900,
  embedded = false,
}: {
  mode: 'comments' | 'activity';
  canComment?: boolean;
  leadHeight?: number;
  /** On mobile the modal's main column flows inside the drawer scrollport. */
  embedded?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={embedded ? undefined : scrollRef}
      data-testid="scrollport"
      style={{ overflowY: 'auto', height: 400, width: 520 }}
    >
      <div ref={embedded ? scrollRef : undefined}>
        <div style={{ height: leadHeight }}>Large task brief</div>
        <TaskLogViewport scrollRef={scrollRef}>
          <ActorDirectoryBoundary organizationId="org-1" projectId="project-1">
            {mode === 'comments' ? (
              <TaskComments
                taskId="task-1"
                organizationId="org-1"
                projectId="project-1"
                canComment={canComment}
                currentUserId="user-1"
                commentCount={state.comments.length}
              />
            ) : (
              <TaskTimeline
                taskId="task-1"
                organizationId="org-1"
                projectId="project-1"
              />
            )}
          </ActorDirectoryBoundary>
        </TaskLogViewport>
      </div>
    </div>
  );
}

function listStart(list: HTMLElement, scroller: HTMLElement) {
  return (
    list.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

function ReversePageHarness({ canWork = false }: { canWork?: boolean }) {
  return (
    <div
      data-testid="scrollport"
      style={{
        overflowY: 'auto',
        height: 400,
        width: 520,
        display: 'flex',
        flexDirection: 'column-reverse',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ height: 900 }}>Large task brief</div>
        <TaskConversation
          taskId="task-1"
          organizationId="org-1"
          projectId="project-1"
          canComment={false}
          canWork={canWork}
        />
      </div>
    </div>
  );
}

async function scrollTo(scroller: HTMLElement, top: number) {
  await act(async () => {
    scroller.scrollTo({ top, behavior: 'instant' });
  });
}

beforeEach(() => {
  state.comments = Array.from({ length: 2500 }, (_, index) => ({
    messageId: `comment-${index}`,
    authorType: 'user',
    authorId: 'user-1',
    body: `Comment ${index} opening line.\n\n@ada reports **ready**.\n\n${'A paragraph of task details. '.repeat(4 + (index % 12))}`,
    createdAt: Date.UTC(2026, 9, 5, 12) - index * 1000,
  }));
  state.activity = [];
  state.runs = [];
  state.hasEarlier = true;
  state.loadEarlier.mockClear();
  state.directoryRead.mockClear();
  state.edit.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('task modal log window', () => {
  it('keeps accumulated comment pages bounded behind a large brief and reaches every older comment', async () => {
    render(<Harness mode="comments" embedded />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    expect(list).not.toBeNull();
    if (list === null) throw new Error('Missing comment list');
    await waitFor(() =>
      expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40),
    );
    await scrollTo(scroller, listStart(list, scroller));
    await waitFor(() =>
      expect(screen.getByText('Comment 0 opening line.')).toBeVisible(),
    );
    expect(state.directoryRead).toHaveBeenCalledTimes(1);
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText('Comment 2499 opening line.')).toBeVisible(),
    );
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    await userEvent.click(
      screen.getByRole('button', { name: 'detail.showEarlierComments' }),
    );
    expect(state.loadEarlier).toHaveBeenCalledTimes(1);
  });

  it('windows thousands of activity events using the same measured scroll origin', async () => {
    state.activity = Array.from({ length: 2500 }, (_, index) => ({
      _id: `event-${index}`,
      actorType: 'user',
      actorId: 'user-1',
      action: 'title.changed',
      toValue: `Recorded title ${index}`,
      createdAt: Date.UTC(2026, 9, 5, 12) - index * 1000,
    }));
    render(<Harness mode="activity" />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing activity list');
    await scrollTo(scroller, listStart(list, scroller));
    await waitFor(() =>
      expect(screen.getByText(/Recorded title 0$/)).toBeVisible(),
    );
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText(/Recorded title 2499$/)).toBeVisible(),
    );
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    expect(state.directoryRead).toHaveBeenCalledTimes(1);
  });

  it('measures a timeline that mounts after activity finishes loading below the brief', async () => {
    render(<Harness mode="activity" />);
    const scroller = screen.getByTestId('scrollport');
    expect(scroller.querySelector('ul')).toBeNull();
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    await act(async () => {
      state.activity = Array.from({ length: 2500 }, (_, index) => ({
        _id: `event-${index}`,
        actorType: 'user',
        actorId: 'user-1',
        action: 'title.changed',
        toValue: `Loaded title ${index}`,
        createdAt: Date.UTC(2026, 9, 5, 12) - index * 1000,
      }));
      for (const listener of state.activityListeners) listener();
    });
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing loaded activity list');
    await scrollTo(scroller, listStart(list, scroller));
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    await waitFor(() =>
      expect(screen.getByText(/Loaded title 0$/)).toBeVisible(),
    );
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText(/Loaded title 2499$/)).toBeVisible(),
    );
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
  });

  it('keeps an active edit mounted when the discussion crosses the window threshold', async () => {
    state.comments = state.comments.slice(0, 90);
    const view = render(<Harness mode="comments" canComment leadHeight={0} />);
    const comment = await screen.findByText('Comment 0 opening line.');
    const row = comment.closest('li');
    if (row === null) throw new Error('Missing comment row');
    await userEvent.click(
      within(row).getByRole('button', { name: 'actions.edit' }),
    );
    const field = within(row).getByRole('textbox');
    await userEvent.fill(field, 'Draft retained across windowing');
    state.comments = Array.from({ length: 120 }, (_, index) => ({
      ...state.comments[index % state.comments.length],
      messageId: `comment-${index}`,
    }));
    view.rerender(<Harness mode="comments" canComment leadHeight={0} />);
    await waitFor(() => expect(field).toBeInTheDocument());
    expect(field).toHaveValue('Draft retained across windowing');
  });

  it('keeps an edit draft mounted after scrolling into older pages and moving focus', async () => {
    render(<Harness mode="comments" canComment leadHeight={0} />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing comment list');
    await scrollTo(scroller, listStart(list, scroller));
    const comment = await screen.findByText('Comment 0 opening line.');
    const row = comment.closest('li');
    if (row === null) throw new Error('Missing comment row');
    await userEvent.click(
      within(row).getByRole('button', { name: 'actions.edit' }),
    );
    const field = within(row).getByRole('textbox');
    await userEvent.fill(field, 'Draft that survives scrolling');
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText('Comment 2499 opening line.')).toBeVisible(),
    );
    expect(field).toHaveFocus();
    expect(field).toHaveValue('Draft that survives scrolling');
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    await userEvent.click(
      screen.getByRole('button', { name: 'detail.showEarlierComments' }),
    );
    expect(field).not.toHaveFocus();
    expect(field).toBeInTheDocument();
    expect(field).toHaveValue('Draft that survives scrolling');
    await userEvent.click(
      within(row).getByRole('button', { name: 'actions.save' }),
    );
    await waitFor(() =>
      expect(state.edit).toHaveBeenCalledWith({
        messageId: 'comment-0',
        body: 'Draft that survives scrolling',
      }),
    );
  });

  it('retains a delete confirmation opener through offscreen scrolling and cancellation, then releases it after focus leaves', async () => {
    render(<Harness mode="comments" canComment leadHeight={0} />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing comment list');
    await scrollTo(scroller, listStart(list, scroller));
    const comment = await screen.findByText('Comment 0 opening line.');
    const row = comment.closest('li');
    if (row === null) throw new Error('Missing comment row');
    const trigger = within(row).getByRole('button', { name: 'actions.delete' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', {
      name: 'comment.deleteConfirm',
    });
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(
        screen.getByText('Comment 2499 opening line.'),
      ).toBeInTheDocument(),
    );
    expect(trigger).not.toHaveFocus();
    expect(dialog).toBeInTheDocument();
    expect(trigger).toBeInTheDocument();
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'actions.cancel' }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toBeInTheDocument();
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText('Comment 2499 opening line.')).toBeVisible(),
    );
    expect(trigger).toHaveFocus();
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    await userEvent.click(
      screen.getByRole('button', { name: 'detail.showEarlierComments' }),
    );
    await waitFor(() => expect(trigger).not.toBeInTheDocument());
  });

  it('lets the inline mention menu overflow a focused comment without offscreen paint containment clipping it', async () => {
    state.comments = state.comments.slice(0, 50);
    render(<Harness mode="comments" canComment leadHeight={0} />);
    const comment = await screen.findByText('Comment 0 opening line.');
    const row = comment.closest('li');
    if (row === null) throw new Error('Missing comment row');
    await userEvent.click(
      within(row).getByRole('button', { name: 'actions.edit' }),
    );
    const field = within(row).getByRole('textbox');
    await userEvent.fill(field, '@');
    const listbox = await screen.findByRole('listbox', {
      name: 'mentionPicker.title',
    });
    const panel = listbox.parentElement;
    if (panel === null) throw new Error('Missing mention menu panel');
    await waitFor(() => {
      expect(getComputedStyle(row).contentVisibility).toBe('visible');
      const box = panel.getBoundingClientRect();
      expect(box.top).toBeLessThan(row.getBoundingClientRect().top);
      expect(
        panel.contains(
          document.elementFromPoint(box.left + 20, box.top + box.height / 2),
        ),
      ).toBe(true);
    });
    await userEvent.keyboard('{Enter}');
    expect(field).toHaveValue('@grace ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(
      within(row).getByRole('button', { name: 'actions.save' }),
    );
    await waitFor(() =>
      expect(state.edit).toHaveBeenCalledWith({
        messageId: 'comment-0',
        body: '@grace',
      }),
    );
  });

  it('tracks a brief that grows above the timeline after the task is opened', async () => {
    state.activity = Array.from({ length: 2500 }, (_, index) => ({
      _id: `event-${index}`,
      actorType: 'user',
      actorId: 'user-1',
      action: 'title.changed',
      toValue: `Recorded title ${index}`,
      createdAt: Date.UTC(2026, 9, 5, 12) - index * 1000,
    }));
    const view = render(<Harness mode="activity" leadHeight={900} />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing activity list');
    await scrollTo(scroller, listStart(list, scroller));
    await screen.findByText(/Recorded title 0$/);
    view.rerender(<Harness mode="activity" leadHeight={1500} />);
    await waitFor(() =>
      expect(listStart(list, scroller)).toBeGreaterThan(1500),
    );
    await scrollTo(scroller, listStart(list, scroller));
    await waitFor(() => {
      const first = screen.getByText(/Recorded title 0$/);
      expect(first.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        scroller.getBoundingClientRect().top - 2,
      );
      expect(first.getBoundingClientRect().top).toBeLessThan(
        scroller.getBoundingClientRect().bottom,
      );
    });
  });

  it('keeps a hovered actor preview source mounted while it is open outside the visible range', async () => {
    state.activity = Array.from({ length: 2500 }, (_, index) => ({
      _id: `event-${index}`,
      actorType: index === 0 ? 'agent' : 'user',
      actorId: index === 0 ? 'agent-1' : 'user-1',
      action: 'title.changed',
      toValue: `Recorded title ${index}`,
      createdAt: Date.UTC(2026, 9, 5, 12) - index * 1000,
    }));
    render(<Harness mode="activity" leadHeight={0} />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing activity list');
    const trigger = await screen.findByRole('button', { name: 'Reporter' });
    fireEvent.mouseEnter(trigger);
    await screen.findByText('Reporter preview remains open.');
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText(/Recorded title 2499$/)).toBeVisible(),
    );
    expect(trigger).not.toHaveFocus();
    expect(trigger).toBeInTheDocument();
    expect(
      screen.getByText('Reporter preview remains open.'),
    ).toBeInTheDocument();
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trigger).not.toBeInTheDocument());
  });

  it('keeps the stored run outcome dialog open when its timeline row leaves the viewport', async () => {
    state.activity = Array.from({ length: 2500 }, (_, index) => ({
      _id: `event-${index}`,
      actorType: 'user',
      actorId: 'user-1',
      action: 'title.changed',
      toValue: `Recorded title ${index}`,
      createdAt: Date.UTC(2026, 9, 5, 12) - index * 1000,
    }));
    state.runs = [
      {
        runId: 'run-1',
        agentSlug: 'reporter',
        trigger: 'manual',
        status: 'failed',
        startedAt: Date.UTC(2026, 9, 5, 12, 1),
        costCents: 0,
        error: 'Stored outcome remains readable.',
      },
    ];
    render(<Harness mode="activity" leadHeight={0} />);
    const scroller = screen.getByTestId('scrollport');
    const list = scroller.querySelector('ul');
    if (list === null) throw new Error('Missing activity list');
    const trigger = await screen.findByRole('button', {
      name: 'agentRuns.detail.openAria',
    });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', {
      name: 'agentRuns.detail.failedTitle',
    });
    await scrollTo(
      scroller,
      listStart(list, scroller) + list.offsetHeight - scroller.clientHeight,
    );
    await waitFor(() =>
      expect(screen.getByText(/Recorded title 2499$/)).toBeInTheDocument(),
    );
    expect(trigger).not.toHaveFocus();
    expect(trigger).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText('Stored outcome remains readable.'),
    ).toBeVisible();
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(40);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});

it('preserves the task page native newest-end anchor and earlier reading mode', async () => {
  state.comments = state.comments.slice(0, 50);
  state.hasEarlier = false;
  const view = render(<ReversePageHarness />);
  const scroller = screen.getByTestId('scrollport');
  await waitFor(() => {
    const latest = screen.getByText('Comment 0 opening line.');
    expect(scroller.scrollTop).toBe(0);
    expect(latest.getBoundingClientRect().top).toBeLessThan(
      scroller.getBoundingClientRect().bottom,
    );
    expect(latest.getBoundingClientRect().bottom).toBeGreaterThan(
      scroller.getBoundingClientRect().top,
    );
  });
  const oldest = screen.getByText('Comment 49 opening line.');
  await act(async () => oldest.scrollIntoView({ block: 'center' }));
  await waitFor(() => {
    const box = oldest.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(
      scroller.getBoundingClientRect().top,
    );
    expect(box.bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    );
  });
  await scrollTo(scroller, -500);
  await waitFor(() => expect(scroller.scrollTop).toBeLessThan(-400));
  // The page retains normal DOM flow and the native negative scroll offset;
  // the modal's positive-offset window never attaches to this reverse layout.
  expect(screen.getAllByText(/Comment \d+ opening line\./)).toHaveLength(50);
  state.comments = [
    {
      messageId: 'new-comment',
      authorType: 'user',
      authorId: 'user-1',
      body: 'A new reply at the newest end.',
      createdAt: Date.UTC(2026, 9, 5, 13),
    },
    ...state.comments,
  ];
  view.rerender(<ReversePageHarness canWork />);
  await waitFor(() => expect(scroller.scrollTop).toBeLessThan(-400));
  await scrollTo(scroller, 0);
  state.comments = [
    {
      messageId: 'newer-comment',
      authorType: 'user',
      authorId: 'user-1',
      body: 'Another reply follows at the foot.',
      createdAt: Date.UTC(2026, 9, 5, 14),
    },
    ...state.comments,
  ];
  view.rerender(<ReversePageHarness />);
  await waitFor(() => {
    const latest = screen.getByText('Another reply follows at the foot.');
    expect(scroller.scrollTop).toBe(0);
    expect(latest.getBoundingClientRect().top).toBeLessThan(
      scroller.getBoundingClientRect().bottom,
    );
    expect(latest.getBoundingClientRect().bottom).toBeGreaterThan(
      scroller.getBoundingClientRect().top,
    );
  });
});
