import '@testing-library/jest-dom/vitest';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import type {
  ChatProjectSummary,
  ChatThreadSummary,
} from '@/app/features/chat/types';
import { cleanup, render, screen } from '@/tests/utils/render';

import type { HomeData } from '../hooks/use-home-data';
import type { HomeItem } from '../lib/home-items';
import { HomeNavigator } from './home-panel';

import '@/app/globals.css';

/**
 * The Home panel laid out by a real browser. jsdom performs no layout, so
 * only here can a long project list be seen crowding the stream, the open
 * row be brought into view, or a drag be released over a project. The rules:
 * PROJECTS takes what its rows need but under half of the column, the stream
 * takes the rest, and each scrolls its own rows; a chat dropped on a project
 * is filed there, and one released over the stream stays where it was.
 */

const ORG = 'org-test';

const backend = vi.hoisted(() => ({
  location: { pathname: '/dashboard/org-test/chat', search: {} } as {
    pathname: string;
    search: Record<string, unknown>;
  },
  home: null as unknown,
  archived: {
    status: 'ready',
    data: { rows: [], nextCursor: null },
  } as unknown,
  holds: { status: 'ready', data: { orgHeld: false, targetIds: [] } },
  move: vi.fn((_threadId: string, _projectId: string | null) =>
    Promise.resolve(true),
  ),
  setArchived: vi.fn((_threadId: string, _archived: boolean) =>
    Promise.resolve(true),
  ),
  navigate: vi.fn(),
}));

// Browser ESM links named imports eagerly, so every mocked module keeps its
// real exports and overrides only what the panel reads.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
    search: _search,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useNavigate: () => backend.navigate,
  useLocation: () => backend.location,
}));

vi.mock('../hooks/use-home-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-home-data')>()),
  useHomeData: () => backend.home,
}));

vi.mock('@/app/features/chat/data/chat-backend', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/chat/data/chat-backend')
  >()),
  useThreadHolds: () => backend.holds,
  useArchivedThreads: () => backend.archived,
  useProjectPin: () => ({ available: true, setPinned: vi.fn() }),
  useThreadProjectMove: () => ({ available: true, move: backend.move }),
}));

vi.mock('@/app/features/chat/data/thread-actions', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/chat/data/thread-actions')
  >()),
  useThreadActions: () => ({
    available: true,
    rename: vi.fn(() => Promise.resolve(true)),
    setPinned: vi.fn(() => Promise.resolve(true)),
    setArchived: backend.setArchived,
    markRead: vi.fn(),
    trash: vi.fn(() => Promise.resolve(true)),
  }),
}));

beforeEach(async () => {
  await resizeViewport(1280, 800);
});

afterEach(() => {
  cleanup();
  backend.move.mockClear();
  backend.setArchived.mockClear();
  // The view, the projects disclosure and the drawer persist in localStorage.
  window.localStorage.clear();
});

type Point = { x: number; y: number };

/** The share of the column PROJECTS may take (its `max-h-[45%]`). */
const PROJECTS_SHARE = 0.45;
/** The `mt-2` between PROJECTS and the stream. */
const STREAM_GAP = 8;
/**
 * A fractional height lands a box edge on a fractional pixel, and a scroll
 * offset snaps to a whole one — edges compare within one pixel.
 */
const SUBPIXEL = 1;

function projectList(count: number): ChatProjectSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `project-${index}`,
    // Zero-padded so the alphabetical sort keeps this order.
    name: `Project ${String(index + 1).padStart(2, '0')}`,
  }));
}

/** Loose chats, newest first, every one of them inside Today. */
function chatList(count: number): ChatThreadSummary[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `chat-${index}`,
    title: `Chat ${String(index + 1).padStart(2, '0')}`,
    kind: 'direct',
    createdAt: now - index,
    updatedAt: now - index,
    archived: false,
    generating: false,
  }));
}

function homeData(
  projects: ChatProjectSummary[],
  threads: ChatThreadSummary[],
): HomeData {
  const items: HomeItem[] = threads.map((thread) => ({
    kind: 'chat',
    id: thread.id,
    title: thread.title ?? '',
    activityAt: thread.updatedAt,
    unread: false,
    generating: false,
    shared: false,
  }));
  return {
    items,
    threadsById: new Map(threads.map((thread) => [thread.id, thread])),
    projects,
    loading: {
      chats: false,
      tasks: false,
      conversations: false,
      projects: false,
    },
    hasInbox: false,
    attention: { chats: 0, tasks: 0, inbox: 0 },
  };
}

/**
 * Mounts the navigator in the desktop panel's column: a fixed-height flex
 * column under the panel header, exactly as `HomePanel` frames it.
 */
function renderHome({
  height = 640,
  projects = [],
  threads = [],
  openThreadId = 'chat-0',
}: {
  height?: number;
  projects?: ChatProjectSummary[];
  threads?: ChatThreadSummary[];
  openThreadId?: string;
}) {
  backend.home = homeData(projects, threads);
  backend.location = {
    pathname: `/dashboard/${ORG}/chat/${openThreadId}`,
    search: {},
  };
  return render(
    <div
      data-testid="frame"
      style={{ height }}
      className="bg-background flex w-70 flex-col overflow-hidden"
    >
      <HomeNavigator organizationId={ORG} />
    </div>,
  );
}

function frame() {
  return screen.getByTestId('frame');
}

function projectsSection() {
  return screen.getByRole('region', { name: 'Projects' });
}

/** The column PROJECTS and the stream share, above the ARCHIVED drawer. */
function column() {
  const element = projectsSection().parentElement;
  if (!element) throw new Error('PROJECTS has no parent column');
  return element;
}

function scrollerIn(root: Element) {
  const element = Array.from(root.querySelectorAll('*')).find((child) =>
    ['auto', 'scroll'].includes(getComputedStyle(child).overflowY),
  );
  if (!(element instanceof HTMLElement)) {
    throw new Error('Found no scrolling element');
  }
  return element;
}

/** PROJECTS' own scrolling rows. */
function projectRows() {
  return scrollerIn(projectsSection());
}

/** The stream's scroller — the element holding the time-banded list. */
function streamRows() {
  const list = screen.getByRole('list', {
    name: 'Your chats, tasks and conversations',
  });
  const element = list.parentElement;
  if (!element) throw new Error('The stream has no scroller');
  return element;
}

function projectRow(name: string) {
  const row = screen
    .getByRole('link', { name: new RegExp(name) })
    .closest('li');
  if (!row) throw new Error(`No row for ${name}`);
  return row;
}

function chatRow(threadId: string) {
  const element = document.querySelector(`[data-thread-id="${threadId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No row for ${threadId}`);
  }
  return element;
}

function box(element: Element) {
  return element.getBoundingClientRect();
}

function centre(element: Element): Point {
  const rect = box(element);
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function scrolls(element: HTMLElement) {
  return element.scrollHeight > element.clientHeight;
}

/** Whether all of `element` is drawn inside `container`'s box. */
function drawnInside(element: Element, container: Element) {
  const inner = box(element);
  const outer = box(container);
  return (
    inner.top >= outer.top - SUBPIXEL && inner.bottom <= outer.bottom + SUBPIXEL
  );
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Resizes the test window and waits for its `resize` event to have fired: a
 * resize landing mid-drag cancels a dnd-kit pointer drag, and a layout read
 * before it would measure the old size.
 */
async function resizeViewport(width: number, height: number) {
  await page.viewport(width, height);
  await expect
    .poll(() => [window.innerWidth, window.innerHeight])
    .toEqual([width, height]);
  await nextFrame();
  await nextFrame();
}

function mouse(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  point: Point,
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      clientX: point.x,
      clientY: point.y,
    }),
  );
}

/**
 * Picks a row up the way dnd-kit's MouseSensor reads a drag: press on it,
 * then move past the 5px activation distance. Resolves once the lifted card
 * is on screen, with the pointer's position.
 */
async function pickUp(source: Element): Promise<Point> {
  const pressed = centre(source);
  mouse(source, 'mousedown', pressed);
  const held = { x: pressed.x, y: pressed.y + 8 };
  mouse(document, 'mousemove', held);
  await expect
    .poll(() => document.querySelector('.cursor-grabbing'))
    .not.toBeNull();
  return held;
}

/**
 * Carries the held row to `to` in steps a frame apart, then keeps nudging the
 * pointer there until `settled` holds: dnd-kit resolves the zone under the
 * pointer in an effect after each move, so a target is judged only once it
 * has had the chance to light up.
 */
async function carryTo(from: Point, to: Point, settled: () => boolean) {
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    mouse(document, 'mousemove', {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await nextFrame();
  }
  for (let nudge = 0; nudge < 30 && !settled(); nudge += 1) {
    mouse(document, 'mousemove', { x: to.x + (nudge % 2), y: to.y });
    await nextFrame();
  }
}

function lit(zone: Element) {
  return zone.className.includes('ring-primary');
}

describe('Home panel in Chromium', () => {
  it.each([800, 480])(
    'holds a long project list under half of a %i px column and scrolls each list',
    (height) => {
      renderHome({
        height,
        projects: projectList(40),
        threads: chatList(60),
      });

      expect(box(projectsSection()).height).toBeLessThanOrEqual(
        box(column()).height * PROJECTS_SHARE + SUBPIXEL,
      );
      expect(scrolls(projectRows())).toBe(true);
      expect(scrolls(streamRows())).toBe(true);
      // The stream runs down to the ARCHIVED drawer, which stays in the frame.
      expect(box(streamRows()).bottom).toBeLessThanOrEqual(
        box(column()).bottom + SUBPIXEL,
      );
      expect(
        drawnInside(screen.getByRole('button', { name: /archived/i }), frame()),
      ).toBe(true);
    },
  );

  it('scrolls the projects without moving the stream', () => {
    renderHome({ projects: projectList(40), threads: chatList(60) });
    const firstChatTop = box(chatRow('chat-0')).top;

    const rows = projectRows();
    rows.scrollTop = rows.scrollHeight;

    expect(box(chatRow('chat-0')).top).toBe(firstChatTop);
    // The last project is reachable inside its own list.
    expect(drawnInside(projectRow('Project 40'), rows)).toBe(true);
  });

  it('keeps a short project list at its own height', () => {
    renderHome({ projects: projectList(2), threads: chatList(60) });

    expect(scrolls(projectRows())).toBe(false);
    expect(drawnInside(projectRow('Project 02'), projectsSection())).toBe(true);
    expect(box(projectsSection()).height).toBeLessThan(
      box(column()).height * PROJECTS_SHARE,
    );
    // The stream starts right under the projects and takes the rest.
    expect(box(streamRows()).top - box(projectsSection()).bottom).toBeCloseTo(
      STREAM_GAP,
      0,
    );
    expect(scrolls(streamRows())).toBe(true);
  });

  it('brings the open chat into view when it sits below the fold', async () => {
    renderHome({
      projects: projectList(4),
      threads: chatList(60),
      openThreadId: 'chat-59',
    });

    const rows = streamRows();
    await expect.poll(() => drawnInside(chatRow('chat-59'), rows)).toBe(true);
    expect(rows.scrollTop).toBeGreaterThan(0);
  });

  it('files a chat dropped on a project', async () => {
    renderHome({ projects: projectList(3), threads: chatList(5) });
    const target = projectRow('Project 02');

    const held = await pickUp(chatRow('chat-2'));
    await carryTo(held, centre(target), () => lit(target));
    expect(lit(target)).toBe(true);
    mouse(document, 'mouseup', centre(target));

    await vi.waitFor(() =>
      expect(backend.move).toHaveBeenCalledWith('chat-2', 'project-1'),
    );
  });

  it('puts back a chat released over the stream, never filing it into a project scrolled out of view', async () => {
    renderHome({
      height: 480,
      projects: projectList(40),
      threads: chatList(3),
    });
    // The projects past the list's fold are still laid out below it —
    // beneath the stream, right where a chat can be released.
    const rows = projectRows();
    const stream = streamRows();
    const hidden = Array.from(projectsSection().querySelectorAll('li')).find(
      (row) => {
        const point = centre(row);
        return (
          box(row).top > box(rows).bottom &&
          point.y > box(stream).top &&
          point.y < box(stream).bottom
        );
      },
    );
    if (!hidden) throw new Error('No project row lies under the stream');

    const held = await pickUp(chatRow('chat-1'));
    await carryTo(held, centre(hidden), () => lit(hidden));
    expect(lit(hidden)).toBe(false);
    mouse(document, 'mouseup', centre(hidden));
    await nextFrame();
    await nextFrame();

    expect(backend.move).not.toHaveBeenCalled();
  });

  it('puts back a chat released over the stream, never archiving it beside the ARCHIVED drawer', async () => {
    renderHome({
      height: 480,
      projects: projectList(2),
      threads: chatList(60),
    });
    // The last chat sits right above the drawer once the stream is scrolled
    // to its end.
    const stream = streamRows();
    stream.scrollTop = stream.scrollHeight;
    const last = chatRow('chat-59');
    expect(drawnInside(last, stream)).toBe(true);
    const drawer = screen.getByRole('button', { name: /archived/i });

    // A short drag down that stays over the stream: the lifted card grazes
    // the drawer, the pointer never leaves the list.
    const held = await pickUp(last);
    const release = { x: held.x, y: box(stream).bottom - 3 };
    expect(release.y).toBeLessThan(box(drawer).top);
    await carryTo(held, release, () => false);
    mouse(document, 'mouseup', release);
    await nextFrame();
    await nextFrame();

    expect(backend.setArchived).not.toHaveBeenCalled();
    expect(backend.move).not.toHaveBeenCalled();
  });
});
