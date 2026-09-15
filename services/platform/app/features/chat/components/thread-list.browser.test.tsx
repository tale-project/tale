import '@testing-library/jest-dom/vitest';
import { cn } from '@tale/ui/cn';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { ChatSubPanelPlaceholder } from '@/app/components/layout/chat-sub-panel-placeholder';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import type { ChatProjectSummary, ChatThreadSummary } from '../types';
import { ThreadList } from './thread-list';

import '@/app/globals.css';

/**
 * The chat list's PROJECTS and CHATS sections, laid out by a real browser.
 * jsdom performs no layout, so only here can a long list be seen pushing the
 * other section out of the panel. The rule: PROJECTS takes what its folders
 * need but at most half of the height above ARCHIVED, CHATS takes the rest,
 * and each section scrolls its own rows under a header that stays put.
 */

const backend = vi.hoisted(() => ({
  projects: { status: 'ready', data: [] } as unknown,
  archived: {
    status: 'ready',
    data: { rows: [], nextCursor: null },
  } as unknown,
  holds: { status: 'ready', data: { orgHeld: false, targetIds: [] } },
  move: vi.fn((_threadId: string, _projectId: string | null) =>
    Promise.resolve(true),
  ),
  navigate: vi.fn(),
}));

// Browser ESM links named imports eagerly, so every mocked module keeps its
// real exports and overrides only what the list reads.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params: _params,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => backend.navigate,
}));

vi.mock('../data/chat-backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/chat-backend')>()),
  useChatProjects: () => backend.projects,
  useThreadHolds: () => backend.holds,
  useArchivedThreads: () => backend.archived,
  useProjectPin: () => ({ available: true, setPinned: vi.fn() }),
  useThreadProjectMove: () => ({ available: true, move: backend.move }),
}));

beforeEach(async () => {
  await resizeViewport(1280, 800);
});

afterEach(() => {
  cleanup();
  backend.projects = { status: 'ready', data: [] };
  backend.archived = { status: 'ready', data: { rows: [], nextCursor: null } };
  backend.move.mockClear();
  document.documentElement.classList.remove('boot-chat-panel-open');
  // Folder and drawer choices persist in localStorage.
  window.localStorage.clear();
});

/** SubPanelSectionHeader's fixed `h-7`. */
const HEADER_HEIGHT = 28;
/** The shared `h-8` row anatomy of folders and chats. */
const ROW_HEIGHT = 32;
/** The `gap-0.5` between everything in the list. */
const GAP = 2;

/** The two places chat-surface mounts the list: the desktop sub-panel's
 * fixed-width column, and the phone drawer's column under its close button. */
const FRAMES = {
  panel: 'w-64',
  drawer: 'w-72 pt-8',
} as const;

type FrameName = keyof typeof FRAMES;
type SectionName = 'Projects' | 'Chats';
type Point = { x: number; y: number };

function projectList(count: number): ChatProjectSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `project-${index}`,
    // Zero-padded so the list's alphabetical sort keeps this order.
    name: `Project ${String(index + 1).padStart(2, '0')}`,
  }));
}

function chatList(
  count: number,
  {
    projectId,
    archived = false,
  }: { projectId?: string; archived?: boolean } = {},
): ChatThreadSummary[] {
  const prefix = archived ? 'archived' : (projectId ?? 'loose');
  return Array.from({ length: count }, (_, index): ChatThreadSummary => ({
    id: `${prefix}-chat-${index}`,
    title: `Chat ${String(index + 1).padStart(2, '0')}`,
    kind: 'direct',
    createdAt: index,
    updatedAt: index,
    archived,
    generating: false,
    ...(projectId !== undefined ? { projectId } : {}),
  }));
}

function Frame({
  height,
  name = 'panel',
  children,
}: {
  height: number;
  name?: FrameName;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="frame"
      style={{ height }}
      className={cn(
        'bg-background flex flex-col overflow-hidden',
        FRAMES[name],
      )}
    >
      {children}
    </div>
  );
}

function renderList({
  height = 640,
  frame = 'panel',
  projects = [],
  threads = [],
  activeThreadId,
}: {
  height?: number;
  frame?: FrameName;
  projects?: ChatProjectSummary[];
  threads?: ChatThreadSummary[];
  activeThreadId?: string;
}) {
  backend.projects = { status: 'ready', data: projects };
  const list = (frameHeight: number) => (
    <Frame height={frameHeight} name={frame}>
      <ThreadList
        organizationId="org-test"
        threads={threads}
        {...(activeThreadId !== undefined ? { activeThreadId } : {})}
      />
    </Frame>
  );
  const view = render(list(height));
  return { ...view, resize: (next: number) => view.rerender(list(next)) };
}

function renderedFrame() {
  return screen.getByTestId('frame');
}

function section(name: SectionName) {
  return screen.getByRole('group', { name });
}

/** The column both sections share: all of the list above ARCHIVED. */
function listColumn() {
  const column = section('Projects').parentElement;
  if (!column) throw new Error('PROJECTS has no parent column');
  return column;
}

function headerOf(name: SectionName) {
  const header = within(section(name)).getByText(name).parentElement;
  if (!header) throw new Error(`${name} has no header row`);
  return header;
}

/** The section's own scrolling rows. */
function rowsOf(name: SectionName) {
  const scroller = Array.from(section(name).children).find((child) =>
    ['auto', 'scroll'].includes(getComputedStyle(child).overflowY),
  );
  if (!(scroller instanceof HTMLElement)) {
    throw new Error(`${name} does not scroll its rows`);
  }
  return scroller;
}

function row(threadId: string) {
  const element = document.querySelector(`[data-thread-id="${threadId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No row for ${threadId}`);
  }
  return element;
}

function requireElement(root: Element, selector: string, index = 0) {
  const element = Array.from(root.querySelectorAll(selector)).at(index);
  if (!element) throw new Error(`Missing ${selector} #${index}`);
  return element;
}

function box(element: Element) {
  return element.getBoundingClientRect();
}

function scrolls(element: HTMLElement) {
  return element.scrollHeight > element.clientHeight;
}

/**
 * Half of an odd height lands on a fractional pixel, and a scroll offset
 * snaps to a whole one — so a list scrolled to its end can leave a last half
 * pixel out of reach. Edges compare within one pixel.
 */
const SUBPIXEL = 1;

/** Whether all of `element` is drawn inside `container`'s box. */
function drawnInside(element: Element, container: Element) {
  const inner = box(element);
  const outer = box(container);
  return (
    inner.top >= outer.top - SUBPIXEL && inner.bottom <= outer.bottom + SUBPIXEL
  );
}

function expectProjectsAtHalf() {
  expect(box(section('Projects')).height).toBeCloseTo(
    box(listColumn()).height / 2,
    0,
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
  const start = box(source);
  const pressed = {
    x: start.left + start.width / 2,
    y: start.top + start.height / 2,
  };
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
 * pointer in an effect after each move, so the target is judged only once it
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

describe('chat list sections in Chromium', () => {
  it.each([
    { frame: 'panel', width: 1280, height: 800 },
    { frame: 'panel', width: 1280, height: 480 },
    { frame: 'drawer', width: 390, height: 844 },
  ] as const)(
    'splits a $height px $frame between two long lists and scrolls each',
    async ({ frame, width, height }) => {
      await resizeViewport(width, height);
      renderList({
        height,
        frame,
        projects: projectList(40),
        threads: chatList(60),
      });

      expectProjectsAtHalf();
      // CHATS takes the rest of the column, right down to ARCHIVED.
      expect(box(section('Chats')).bottom).toBeCloseTo(
        box(listColumn()).bottom,
        0,
      );
      expect(scrolls(rowsOf('Projects'))).toBe(true);
      expect(scrolls(rowsOf('Chats'))).toBe(true);
      // Both headers keep their full height in view, and so does the
      // ARCHIVED drawer under them.
      for (const name of ['Projects', 'Chats'] as const) {
        expect(box(headerOf(name)).height).toBe(HEADER_HEIGHT);
        expect(drawnInside(headerOf(name), renderedFrame())).toBe(true);
      }
      expect(
        drawnInside(
          screen.getByRole('button', { name: /archived/i }),
          renderedFrame(),
        ),
      ).toBe(true);
    },
  );

  it('scrolls one list without moving the other', () => {
    renderList({ projects: projectList(40), threads: chatList(60) });
    const headerTops = {
      projects: box(headerOf('Projects')).top,
      chats: box(headerOf('Chats')).top,
    };

    const projectRows = rowsOf('Projects');
    projectRows.scrollTop = projectRows.scrollHeight;
    const chatRows = rowsOf('Chats');
    chatRows.scrollTop = chatRows.scrollHeight;

    expect(box(headerOf('Projects')).top).toBe(headerTops.projects);
    expect(box(headerOf('Chats')).top).toBe(headerTops.chats);
    // The last folder and the last chat are each reachable in their list.
    expect(
      drawnInside(
        screen.getByRole('button', { name: 'Project 40' }),
        projectRows,
      ),
    ).toBe(true);
    expect(drawnInside(row('loose-chat-59'), chatRows)).toBe(true);
  });

  it('scrolls a focused row into view inside its own list only', () => {
    renderList({ projects: projectList(40), threads: chatList(60) });
    const projectRows = rowsOf('Projects');
    const chatRows = rowsOf('Chats');
    const headerTops = {
      projects: box(headerOf('Projects')).top,
      chats: box(headerOf('Chats')).top,
    };

    // Keyboard focus reaches rows below the fold: the browser scrolls the
    // list the row lives in, never the other list or the panel around both.
    const lastFolder = screen.getByRole('button', { name: 'Project 40' });
    lastFolder.focus();
    expect(lastFolder).toHaveFocus();
    expect(drawnInside(lastFolder, projectRows)).toBe(true);
    expect(chatRows.scrollTop).toBe(0);

    const lastChat = within(row('loose-chat-59')).getByRole('link');
    lastChat.focus();
    expect(lastChat).toHaveFocus();
    expect(drawnInside(lastChat, chatRows)).toBe(true);
    expect(drawnInside(lastFolder, projectRows)).toBe(true);

    expect(box(headerOf('Projects')).top).toBe(headerTops.projects);
    expect(box(headerOf('Chats')).top).toBe(headerTops.chats);
  });

  it('keeps a short project list at its own height', () => {
    renderList({ projects: projectList(2), threads: chatList(60) });

    // The header and two folder rows — no half held back for them.
    expect(box(section('Projects')).height).toBe(
      HEADER_HEIGHT + 2 * (GAP + ROW_HEIGHT),
    );
    expect(scrolls(rowsOf('Projects'))).toBe(false);
    expect(box(section('Chats')).top).toBe(
      box(section('Projects')).bottom + GAP,
    );
    expect(box(section('Chats')).bottom).toBeCloseTo(
      box(listColumn()).bottom,
      0,
    );
    expect(scrolls(rowsOf('Chats'))).toBe(true);
  });

  it('holds a long project list to half even when the chats are few', () => {
    renderList({ projects: projectList(40), threads: chatList(2) });

    expectProjectsAtHalf();
    expect(scrolls(rowsOf('Projects'))).toBe(true);
    const chatRows = rowsOf('Chats');
    expect(scrolls(chatRows)).toBe(false);
    // The room under the two chats still belongs to the section's drop zone.
    const zone = row('loose-chat-1').closest('ul')?.parentElement;
    if (!zone) throw new Error('The loose chats have no drop zone');
    expect(box(zone).height).toBeCloseTo(box(chatRows).height, 0);
  });

  it('scrolls an opened folder inside PROJECTS instead of pushing CHATS away', async () => {
    const { user } = renderList({
      projects: projectList(3),
      threads: [...chatList(30, { projectId: 'project-0' }), ...chatList(10)],
    });

    await user.click(screen.getByRole('button', { name: 'Project 01' }));

    // The disclosure animates open; PROJECTS grows to its cap and stops.
    await expect
      .poll(() => box(section('Projects')).height)
      .toBeCloseTo(box(listColumn()).height / 2, 0);
    expect(scrolls(rowsOf('Projects'))).toBe(true);
    expect(drawnInside(headerOf('Chats'), renderedFrame())).toBe(true);
    expect(drawnInside(row('loose-chat-0'), rowsOf('Chats'))).toBe(true);
  });

  it('re-divides the column when the frame or the ARCHIVED drawer changes height', async () => {
    backend.archived = {
      status: 'ready',
      data: { rows: chatList(12, { archived: true }), nextCursor: null },
    };
    const { user, resize } = renderList({
      height: 900,
      projects: projectList(40),
      threads: chatList(60),
    });
    expectProjectsAtHalf();

    resize(520);
    expectProjectsAtHalf();

    const columnHeight = box(listColumn()).height;
    await user.click(screen.getByRole('button', { name: /archived/i }));
    await expect
      .poll(() => box(listColumn()).height)
      .toBeLessThan(columnHeight);
    expectProjectsAtHalf();
    for (const name of ['Projects', 'Chats'] as const) {
      expect(drawnInside(headerOf(name), renderedFrame())).toBe(true);
    }
  });

  it('keeps the loading skeleton’s geometry for short lists', () => {
    // The class the pre-hydration script sets so the placeholder shows.
    document.documentElement.classList.add('boot-chat-panel-open');
    const { rerender } = renderList({
      projects: projectList(2),
      threads: chatList(6),
    });
    const top = (element: Element) =>
      box(element).top - box(renderedFrame()).top;
    const live = {
      firstFolder: top(screen.getByRole('button', { name: 'Project 01' })),
      divider: top(requireElement(section('Chats'), '.border-t')),
      chatsHeader: top(headerOf('Chats')),
      firstChat: top(row('loose-chat-0')),
    };

    rerender(
      <Frame height={640}>
        <ChatSubPanelPlaceholder />
      </Frame>,
    );

    // The placeholder's anatomy: two header rows, then two folder rows and
    // six chat rows, with one divider between the sections.
    const placeholder = renderedFrame();
    expect(placeholder.querySelectorAll('.h-7')).toHaveLength(2);
    expect(placeholder.querySelectorAll('.h-8')).toHaveLength(8);
    expect(top(requireElement(placeholder, '.h-8', 0))).toBe(live.firstFolder);
    expect(top(requireElement(placeholder, '.border-t'))).toBe(live.divider);
    expect(top(requireElement(placeholder, '.h-7', 1))).toBe(live.chatsHeader);
    expect(top(requireElement(placeholder, '.h-8', 2))).toBe(live.firstChat);
  });

  it('files a chat dropped under a short chat list into Chats, never a folder scrolled out of view', async () => {
    renderList({
      // Enough folders to overflow PROJECTS: the ones scrolled out of view are
      // still laid out beneath CHATS, right under the drop point.
      projects: projectList(40),
      threads: [...chatList(1, { projectId: 'project-0' }), ...chatList(1)],
      // The open chat's folder starts expanded, so its row can be picked up.
      activeThreadId: 'project-0-chat-0',
    });
    const zone = row('loose-chat-0').closest('ul')?.parentElement;
    if (!zone) throw new Error('The loose chats have no drop zone');
    const lastChat = box(row('loose-chat-0'));
    const room = box(rowsOf('Chats'));
    const target = {
      x: room.left + room.width / 2,
      y: (lastChat.bottom + room.bottom) / 2,
    };
    // Well clear of the last row, in the section's empty room.
    expect(target.y - lastChat.bottom).toBeGreaterThan(ROW_HEIGHT);

    const held = await pickUp(row('project-0-chat-0'));
    const zoneLit = () => zone.className.includes('ring-primary');
    await carryTo(held, target, zoneLit);
    // The room lights up as the CHATS drop zone, not a folder out of view.
    expect(zoneLit()).toBe(true);
    mouse(document, 'mouseup', target);

    await vi.waitFor(() =>
      expect(backend.move).toHaveBeenCalledWith('project-0-chat-0', null),
    );
  });
});
