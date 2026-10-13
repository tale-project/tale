import '@testing-library/jest-dom/vitest';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { i18n } from '@/lib/i18n/i18n';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import type { TaskCommentData } from './task-comments';
import { TaskConversation } from './task-conversation';
import { TaskThreadColumn } from './task-thread-column';

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
  TASK_DISCUSSION_PAGE_SIZE: 50,
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
vi.mock(
  '@/app/features/shared/markdown/markdown-renderer',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/shared/markdown/markdown-renderer')
    >()),
    markdownWrapperStyles: '',
    markdownComponents: {
      strong: ({ children }: { children: ReactNode }) => {
        reads.markdown();
        return <strong>{children}</strong>;
      },
    },
  }),
);

/** The history in the column a task is read in, on the page and in the dialog.
 *  `safari`: a browser with no scroll anchoring answers the support question
 *  no, and its scrollport anchors nothing. */
function renderHistory({ safari = false }: { safari?: boolean } = {}) {
  if (safari) {
    const supports = CSS.supports.bind(CSS);
    vi.spyOn(CSS, 'supports').mockImplementation(
      (property: string, value?: string) => {
        if (property.includes('overflow-anchor')) return false;
        return value === undefined
          ? supports(property)
          : supports(property, value);
      },
    );
  }
  const rendered = render(
    <div className="flex h-[480px] w-[640px]">
      <TaskThreadColumn
        brief={<div className="h-48 shrink-0">Task brief</div>}
        conversation={
          <TaskConversation
            taskId="task-1"
            organizationId="org-1"
            projectId="proj-1"
            canComment
            currentUserId="user-1"
          />
        }
        {...(safari ? { scrollerClassName: '[overflow-anchor:none]' } : {})}
      />
    </div>,
  );
  return {
    ...rendered,
    scroller: screen.getByTestId('task-thread-scrollport'),
  };
}

/** How far the reader is from the newest end of a scrollport. */
function distanceToEnd(scroller: HTMLElement) {
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
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
  vi.restoreAllMocks();
  localStorage.removeItem('user-locale');
});

describe('TaskConversation long history (Chromium)', () => {
  it('keeps the earlier-history button focused through a pending page and blocks repeat activation', async () => {
    const pending = Promise.withResolvers<void>();
    reads.pendingPage = pending.promise;
    renderHistory();
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
  });
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
    expect(distanceToEnd(scroller)).toBeLessThan(2);

    act(() => reads.loadEarlier());
    await settledLayout();
    expect(reads.markdown).toHaveBeenCalledTimes(1200);
    expect(reads.directory).toHaveBeenCalledTimes(1);
    expect(newest.getBoundingClientRect().top).toBeCloseTo(before, 0);
    expect(distanceToEnd(scroller)).toBeLessThan(2);
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

    scroller.scrollTop = 0;
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

  it.each([
    { browser: 'a browser that anchors scrolling', safari: false },
    { browser: 'Safari', safari: true },
  ])(
    'loads earlier comments from the keyboard without moving the read comment, in $browser',
    async ({ safari }) => {
      const { scroller } = renderHistory({ safari });
      await settledLayout();
      scroller.scrollTop = 0;
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
    const { scroller } = renderHistory();
    await settledLayout();
    scroller.scrollTop = 0;
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
