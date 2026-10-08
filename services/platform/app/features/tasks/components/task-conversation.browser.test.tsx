import '@testing-library/jest-dom/vitest';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { i18n } from '@/lib/i18n/i18n';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import type { TaskCommentData } from './task-comments';
import { TaskConversation } from './task-conversation';

import '@/app/globals.css';

const reads = vi.hoisted(() => ({
  markdown: vi.fn(),
  directory: vi.fn(),
  editMutation: vi.fn(),
  loadEarlier: () => {},
  pendingPage: null as Promise<void> | null,
  pageRequests: vi.fn(),
}));
const NOON = new Date(2026, 8, 23, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;
const comments: TaskCommentData[] = Array.from(
  { length: 250 },
  (_entry, index) => ({
    messageId: `comment-${index}`,
    authorType: 'user',
    authorId: 'user-1',
    createdAt: NOON - Math.floor(index / 50) * DAY - (index % 50) * 60_000,
    body: `Report ${index}\n\n${Array.from(
      { length: 12 },
      (_paragraph, paragraph) =>
        `Section ${index}.${paragraph}: @ada reviewed the **results**, with a [runbook](/runbook).`,
    ).join('\n\n')}`,
  }),
);

vi.mock('../hooks/queries', () => ({
  useTaskDiscussion: () => {
    const [count, setCount] = useState(50);
    const [isLoadingEarlier, setLoadingEarlier] = useState(false);
    const loaded = useMemo(() => comments.slice(0, count), [count]);
    const loadEarlier = useCallback(() => {
      reads.pageRequests();
      if (reads.pendingPage === null) {
        setCount((prior) => prior + 50);
        return;
      }
      setLoadingEarlier(true);
      void reads.pendingPage.then(() => {
        setCount((prior) => prior + 50);
        setLoadingEarlier(false);
      });
    }, []);
    reads.loadEarlier = loadEarlier;
    return {
      comments: loaded,
      hasEarlier: count < comments.length,
      isLoadingEarlier,
      loadEarlier,
    };
  },
  useTaskActivity: () => ({ activity: [] }),
  useTaskAgentRuns: () => ({ runs: [] }),
}));

vi.mock('../hooks/mutations', () => ({
  useAddTaskComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteTaskComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useEditTaskComment: () => {
    reads.editMutation();
    return { isPending: false, mutateAsync: vi.fn(async () => {}) };
  },
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useAssignableActors: () => ({ assignableMembers: [], assignableAgents: [] }),
  useActorDirectory: () => {
    reads.directory();
    return {
      members: [{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }],
      agents: [],
      automations: [],
      resolveActor: () => ({ name: 'Ada' }),
      resolveActorPreview: () => null,
    };
  },
}));
vi.mock('../lib/mention-actor-options', async (original) => ({
  ...(await original<typeof import('../lib/mention-actor-options')>()),
  useMentionActorOptions: () => [],
}));
vi.mock('./mention-trigger-chips', () => ({ MentionTriggerChips: () => null }));
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {
    strong: ({ children }: { children: ReactNode }) => {
      reads.markdown();
      return <strong>{children}</strong>;
    },
  },
}));

function renderHistory(reverse = true) {
  const rendered = render(
    <div
      data-testid="task-history-scroll"
      className={`flex h-[480px] w-[640px] overflow-y-auto ${reverse ? 'flex-col-reverse' : 'flex-col'}`}
    >
      <div className="flex shrink-0 flex-col gap-8 p-6">
        <div className="h-48 shrink-0">Task brief</div>
        <TaskConversation
          taskId="task-1"
          organizationId="org-1"
          projectId="proj-1"
          canComment
          currentUserId="user-1"
        />
      </div>
    </div>,
  );
  return {
    ...rendered,
    scroller: screen.getByTestId('task-history-scroll'),
  };
}

function commentRow(index: number) {
  const paragraph = screen.getByText(`Report ${index}`);
  const row = paragraph.closest<HTMLElement>('[class~="group/comment"]');
  if (row === null) throw new Error('Comment row is missing');
  return row;
}

async function settledLayout() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    }),
  );
}

beforeEach(async () => {
  await page.viewport(1000, 760);
  localStorage.setItem('user-locale', 'en-US');
  await i18n.changeLanguage('en-US');
  reads.markdown.mockClear();
  reads.directory.mockClear();
  reads.editMutation.mockClear();
  reads.pageRequests.mockClear();
  reads.pendingPage = null;
});
afterEach(() => {
  cleanup();
  localStorage.removeItem('user-locale');
});

describe('TaskConversation long history (Chromium)', () => {
  it.each([false, true])(
    'keeps the earlier-history button focused through a pending page and blocks repeat activation (reverse scrollport: %s)',
    async (reverse) => {
      const pending = Promise.withResolvers<void>();
      reads.pendingPage = pending.promise;
      renderHistory(reverse);
      const earlier = screen.getByRole('button', {
        name: 'Show earlier comments',
      });
      earlier.focus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(earlier).toHaveAttribute('aria-busy', 'true'));
      expect(earlier).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      // Browser automation treats aria-disabled as inert before dispatch;
      // the native click proves our handler also rejects activation itself.
      earlier.click();
      expect(reads.pageRequests).toHaveBeenCalledTimes(1);
      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      await waitFor(() => expect(earlier).not.toHaveAttribute('aria-busy'));
      expect(earlier).toHaveFocus();
      await waitFor(() =>
        expect(screen.getByText('Report 99')).toBeInTheDocument(),
      );
    },
  );
  it('skips offscreen layout while preserving newest anchoring and added-page parse bounds', async () => {
    const { container, scroller } = renderHistory();
    await settledLayout();
    const newest = commentRow(0);
    await Promise.all(
      newest.parentElement
        ?.getAnimations()
        .map((animation) => animation.finished) ?? [],
    );
    const before = newest.getBoundingClientRect().top;
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[class~="group/comment"]'),
    );
    expect(rows).toHaveLength(50);
    expect(getComputedStyle(rows[0]!).contentVisibility).toBe('auto');
    expect(
      rows.filter(
        (row) =>
          !row
            .querySelector('p')
            ?.checkVisibility({ contentVisibilityAuto: true }),
      ).length,
    ).toBeGreaterThan(30);
    expect(reads.directory).toHaveBeenCalledTimes(1);
    expect(reads.editMutation).not.toHaveBeenCalled();
    expect(reads.markdown).toHaveBeenCalledTimes(600);
    expect(scroller.scrollTop).toBe(0);

    act(() => reads.loadEarlier());
    await settledLayout();
    expect(reads.markdown).toHaveBeenCalledTimes(1200);
    expect(reads.directory).toHaveBeenCalledTimes(1);
    expect(newest.getBoundingClientRect().top).toBeCloseTo(before, 0);
    expect(scroller.scrollTop).toBe(0);
    const region = screen.getByRole('region');
    expect(region.textContent?.indexOf('Report 99')).toBeLessThan(
      region.textContent?.indexOf('Report 0') ?? 0,
    );
  });

  it('retains an edit draft and its keyboard path across offscreen scrolling and earlier pages', async () => {
    const { scroller } = renderHistory();
    const newest = commentRow(0);
    // The comment's icon action, named by its label.
    const edit = Array.from(newest.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Edit',
    );
    if (edit === undefined) throw new Error('Edit control is missing');
    edit.focus();
    await userEvent.keyboard('{Enter}');
    const field = newest.querySelector('textarea');
    if (field === null) throw new Error('Comment editor is missing');
    expect(reads.editMutation).toHaveBeenCalledTimes(1);
    await userEvent.fill(field, 'Keep this unfinished review');
    expect(getComputedStyle(newest).contentVisibility).toBe('visible');

    scroller.scrollTop = -scroller.scrollHeight;
    await settledLayout();
    act(() => reads.loadEarlier());
    await settledLayout();
    expect(newest.querySelector('textarea')).toBe(field);
    expect(field).toHaveValue('Keep this unfinished review');

    await userEvent.keyboard('{Tab}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus(),
    );
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await settledLayout();
    expect(field).toHaveFocus();
    expect(field.getBoundingClientRect().bottom).toBeGreaterThan(
      scroller.getBoundingClientRect().top,
    );
    expect(field.getBoundingClientRect().top).toBeLessThan(
      scroller.getBoundingClientRect().bottom,
    );
  });

  it.each(['reverse', 'forward'])(
    'loads earlier comments from the keyboard without moving the read comment in the %s scrollport',
    async (direction) => {
      const { scroller } = renderHistory(direction === 'reverse');
      await settledLayout();
      scroller.scrollTop = direction === 'reverse' ? -scroller.scrollHeight : 0;
      await settledLayout();
      const earlier = screen.getByRole('button', {
        name: 'Show earlier comments',
      });
      earlier.focus();
      await settledLayout();
      const oldest = commentRow(49);
      await Promise.all(
        oldest.parentElement
          ?.getAnimations()
          .map((animation) => animation.finished) ?? [],
      );
      const before = oldest.getBoundingClientRect().top;
      const parses = reads.markdown.mock.calls.length;

      await userEvent.keyboard('{Enter}');
      await settledLayout();
      expect(earlier).toHaveFocus();
      expect(commentRow(49)).toBe(oldest);
      await expect
        .poll(() => oldest.getBoundingClientRect().top)
        .toBeCloseTo(before, 0);
      expect(reads.markdown).toHaveBeenCalledTimes(parses + 600);
      const band = oldest.closest('ol')?.parentElement;
      const divider = (day: Element | null | undefined) =>
        day?.querySelector('[data-slot="thread-day-divider"]')?.textContent;
      expect(divider(band)).toContain('September 23');
      expect(divider(band?.previousElementSibling)).toContain('September 22');
    },
  );

  it('gives scroll control back immediately when the reader steers during anchor settling', async () => {
    const { scroller } = renderHistory(false);
    await settledLayout();
    const earlier = screen.getByRole('button', {
      name: 'Show earlier comments',
    });
    const before = scroller.style.overflowAnchor;
    act(() => earlier.click());
    expect(scroller.style.overflowAnchor).toBe('none');
    scroller.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, deltaY: 120 }),
    );
    expect(scroller.style.overflowAnchor).toBe(before);
    await settledLayout();
    expect(scroller.style.overflowAnchor).toBe(before);
  });
});
