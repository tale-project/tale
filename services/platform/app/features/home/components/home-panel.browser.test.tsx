import '@testing-library/jest-dom/vitest';
import { AccentColorProvider } from '@tale/ui/accent-color';
import { Dialog } from '@tale/ui/dialog/dialog';
import axe from 'axe-core';
import { useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type {
  ChatProjectSummary,
  ChatThreadSummary,
} from '@/app/features/chat/types';
import { projectConversationItem } from '@/lib/shared/conversations/conversation-item';
import { contrastRatio, deriveAccentPalette } from '@/lib/utils/color';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import { painted } from '@/tests/utils/paint';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import type { HomeData } from '../hooks/use-home-data';
import {
  DRAFT_ROW_KEY,
  type HomeGroup,
  type HomeItem,
} from '../lib/home-items';
import { HomeNavigator, HomePanel } from './home-panel';
import { HomePanelProvider } from './home-panel-context';
import { HomeConversationRow } from './home-rows';
import {
  HomeStream,
  WINDOWED_STREAM_MIN_ROWS,
  type HomeRowPlacement,
} from './home-stream';

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

it.each([320, 1280])(
  'renders a cleaned mail preview as literal text at %ipx',
  async (width) => {
    await page.viewport(width, 720);
    const html =
      `<style>${'.mail { color: red; }'.repeat(20)}</style>` +
      '<table><tr><td></td><td>Your code is &lt;123456&gt;; type &amp;amp; literally.</td></tr></table>';
    const projected = projectConversationItem({
      conversation: { id: 'mail', organizationId: ORG, createdAt: Date.now() },
      contact: null,
      messages: [
        {
          id: 'message',
          direction: 'inbound',
          content: html,
          metadata: { html },
          createdAt: Date.now(),
        },
      ],
    });
    const preview = projected.lastMessagePreview;
    if (typeof preview !== 'string')
      throw new Error('The mail preview is missing');
    render(
      <ul style={{ width: Math.min(width - 32, 400) }}>
        <HomeConversationRow
          organizationId={ORG}
          active={false}
          item={{
            kind: 'conversation',
            id: 'mail',
            title: 'Account notice',
            activityAt: Date.now(),
            unread: false,
            status: 'open',
            contactLabel: 'Support',
            preview,
          }}
        />
      </ul>,
    );
    const row = screen.getByRole('link', { name: /Account notice/ });
    expect(row).toHaveTextContent(
      'Your code is <123456>; type &amp; literally.',
    );
    expect(row).not.toHaveTextContent('color: red');
    expect(row).not.toHaveTextContent('|');
    expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(width);
  },
);

/**
 * A row's checkbox takes a real pointer. It lies over the contact's initials,
 * but sat under the row's link — lifted above the sliding highlight — so a
 * click or a tap there opened the conversation, and a selection could start
 * from the keyboard only (CONV-F28). jsdom performs no hit-testing; only a
 * real engine shows which element a pointer at that spot reaches.
 */
it.each([
  [1280, true],
  [390, false],
])(
  'ticks a row checkbox under a real pointer at %ipx (pointing at the row first: %s)',
  async (width, pointFirst) => {
    await page.viewport(width, 720);
    const onChange = vi.fn();
    render(
      <ul style={{ width: Math.min(width - 32, 400) }}>
        <HomeConversationRow
          organizationId={ORG}
          active={false}
          item={{
            kind: 'conversation',
            id: 'mail',
            title: 'Invoice shows the wrong VAT',
            activityAt: Date.now(),
            unread: false,
            status: 'open',
            contactLabel: 'Support',
          }}
          selection={{
            checked: false,
            active: false,
            onChange,
            label: 'Select conversation',
          }}
        />
      </ul>,
    );
    const link = screen.getByRole('link', {
      name: /Invoice shows the wrong VAT/,
    });
    const checkbox = screen.getByRole('checkbox', {
      name: 'Select conversation',
    });
    // A mouse finds the box by pointing at the row, which reveals it; on a
    // phone, where nothing hovers, it is there from the start.
    if (pointFirst) await page.elementLocator(link).hover();
    const bounds = checkbox.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    expect(checkbox.contains(hit)).toBe(true);

    await page.elementLocator(checkbox).click();
    expect(onChange).toHaveBeenCalledWith(true);
  },
);

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
  useParams: () => ({
    threadId: /\/chat\/([^/]+)$/.exec(backend.location.pathname)?.[1],
  }),
}));

// The Inbox view's own list reads the conversations backend; the cases here
// judge the panel around it.
vi.mock('./home-inbox-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./home-inbox-list')>()),
  HomeInboxList: () => <p>Inbox conversations</p>,
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'u1' } }),
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
  document.documentElement.style.removeProperty('--primary');
  document.documentElement.style.removeProperty('--ring');
  document.documentElement.classList.remove('dark');
  backend.move.mockClear();
  backend.setArchived.mockClear();
  // The view, the projects disclosure and the drawer persist in localStorage.
  window.localStorage.clear();
});

type Point = { x: number; y: number };

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

/**
 * Loose chats, newest first, every one of them inside Today. `filed` puts
 * the first few of them in a project.
 */
function chatList(
  count: number,
  filed?: { projectId: string; count: number },
): ChatThreadSummary[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `chat-${index}`,
    title: `Chat ${String(index + 1).padStart(2, '0')}`,
    kind: 'direct',
    createdAt: now - index,
    updatedAt: now - index,
    archived: false,
    generating: false,
    ...(filed !== undefined && index < filed.count
      ? { projectId: filed.projectId }
      : {}),
  }));
}

/**
 * `threads` and a chat a live read brings in from elsewhere (another tab, an
 * agent): the newest of all, so it leads the stream and every row moves down.
 */
function withArrivedChat(threads: ChatThreadSummary[]): ChatThreadSummary[] {
  const newest = Math.max(...threads.map((thread) => thread.updatedAt));
  return [
    {
      id: 'chat-arrived',
      title: 'Arrived chat',
      kind: 'direct',
      createdAt: newest + 1,
      updatedAt: newest + 1,
      archived: false,
      generating: false,
    },
    ...threads,
  ];
}

function homeData(
  projects: ChatProjectSummary[],
  threads: ChatThreadSummary[],
  unread: readonly string[] = [],
): HomeData {
  const items: HomeItem[] = threads.map((thread) => ({
    kind: 'chat',
    id: thread.id,
    title: thread.title ?? '',
    activityAt: thread.updatedAt,
    unread: unread.includes(thread.id),
    generating: false,
    shared: false,
    ...(thread.projectId !== undefined ? { projectId: thread.projectId } : {}),
  }));
  return {
    items,
    threadsById: new Map(threads.map((thread) => [thread.id, thread])),
    projects,
    moreProjects: false,
    loading: {
      chats: false,
      tasks: false,
      conversations: false,
      projects: false,
    },
    failed: { chats: false, tasks: false, conversations: false },
    retrying: false,
    retry: () => undefined,
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
  unread = [],
  variant = 'panel',
  width,
  view = 'chats',
}: {
  height?: number;
  projects?: ChatProjectSummary[];
  threads?: ChatThreadSummary[];
  openThreadId?: string;
  unread?: readonly string[];
  /** `screen` is the phone's Home, as its route mounts it. */
  variant?: 'panel' | 'screen';
  /** Overrides the panel's column width, e.g. a phone's full width. */
  width?: number;
  view?: string;
}) {
  localStorage.setItem(`home-view-${ORG}`, JSON.stringify(view));
  let read = { projects, threads };
  backend.home = homeData(projects, threads, unread);
  backend.location = {
    pathname: `/dashboard/${ORG}/chat/${openThreadId}`,
    search: {},
  };
  const home = () => (
    <div
      data-testid="frame"
      style={{ height, ...(width !== undefined ? { width } : {}) }}
      className={`bg-background flex w-70 flex-col overflow-hidden ${variant === 'screen' ? 'mobile-nav-shell' : ''}`}
    >
      <HomeNavigator organizationId={ORG} variant={variant} />
      {variant === 'screen' && (
        <nav aria-label="Primary navigation" className="mobile-tab-bar" />
      )}
    </div>
  );
  const result = render(home());
  return {
    ...result,
    navigateTo(threadId: string) {
      backend.location = {
        pathname: `/dashboard/${ORG}/chat/${threadId}`,
        search: {},
      };
      result.rerender(home());
    },
    /** Opens a fresh chat, whose draft row leads the stream. */
    startChat() {
      backend.location = {
        pathname: `/dashboard/${ORG}/chat`,
        search: { new: true },
      };
      result.rerender(home());
    },
    /** Hands the panel its next live read, as a refetch does. */
    update(next: {
      projects?: ChatProjectSummary[];
      threads?: ChatThreadSummary[];
    }) {
      read = { ...read, ...next };
      backend.home = homeData(read.projects, read.threads, unread);
      result.rerender(home());
    },
  };
}

function frame() {
  return screen.getByTestId('frame');
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

/** The stream's list itself, also while a dialog hides the page behind it. */
function streamList() {
  return screen.getByRole('list', {
    name: 'Your chats, tasks and conversations',
    hidden: true,
  });
}

function chatRow(threadId: string) {
  const element = document.querySelector(`[data-thread-id="${threadId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No row for ${threadId}`);
  }
  return element;
}

/** The chat rows in the page, by thread. */
function drawnChatRows() {
  return new Map(
    [...document.querySelectorAll<HTMLElement>('[data-thread-id]')].map(
      (row) => [row.dataset.threadId ?? '', row],
    ),
  );
}

/**
 * The rows `before` drew that `after` draws too: kept as the same elements,
 * or remounted as new ones, which is what replacing the list does.
 */
function survivors(
  before: ReadonlyMap<string, Element>,
  after: ReadonlyMap<string, Element>,
) {
  const kept: string[] = [];
  const remounted: string[] = [];
  for (const [key, row] of after) {
    const previous = before.get(key);
    if (previous === undefined) continue;
    (previous === row ? kept : remounted).push(key);
  }
  return { kept, remounted };
}

/**
 * Waits out the fade a Home list plays as it mounts (`animate-in` on its
 * root). Call it straight after the render: a list whose root is replaced
 * plays the fade again, and a settled one plays nothing.
 */
async function fadedIn(list: Element) {
  const fades = list.getAnimations();
  expect(fades).not.toHaveLength(0);
  await Promise.all(fades.map((fade) => fade.finished));
}

/**
 * Takes a stream of 60 chats across the window threshold and back, the way
 * live reads do: a chat arriving from elsewhere makes 61 rows, of which only
 * those near the view are mounted, and its leaving makes 60 again, all of
 * them mounted. `check` runs on each side.
 */
async function crossTheWindowThreshold(
  view: ReturnType<typeof renderHome>,
  check: () => void,
) {
  view.update({
    threads: withArrivedChat(chatList(WINDOWED_STREAM_MIN_ROWS)),
  });
  await expect
    .poll(() => drawnChatRows().size)
    .toBeLessThan(WINDOWED_STREAM_MIN_ROWS);
  check();
  view.update({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
  expect(drawnChatRows().size).toBe(WINDOWED_STREAM_MIN_ROWS);
  check();
}

function box(element: Element) {
  return element.getBoundingClientRect();
}

function centre(element: Element): Point {
  const rect = box(element);
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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

describe('Home panel in Chromium', () => {
  it('keeps an inline rename draft and focus when live rows cross the virtual threshold', async () => {
    const view = renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    const list = streamList();
    await page
      .elementLocator(
        within(chatRow('chat-0')).getByRole('button', { name: 'More actions' }),
      )
      .click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = screen.getByRole('textbox', { name: 'Rename' });
    await page.elementLocator(input).fill('Keep this unsaved title');
    await crossTheWindowThreshold(view, () => {
      expect(input.isConnected).toBe(true);
      expect(input).toHaveValue('Keep this unsaved title');
      expect(input).toHaveFocus();
      // One list on both sides: had it been replaced, the row and its rename
      // state would have gone with it.
      expect(streamList()).toBe(list);
    });
  });

  it('keeps the reading position and viewport when live rows cross the window threshold', async () => {
    const view = renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    const stream = streamRows();
    chatRow('chat-20').scrollIntoView({ block: 'start' });
    await nextFrame();
    await nextFrame();
    const anchor = chatRow('chat-20');
    const offset = stream.scrollTop;
    const anchorTop = box(anchor).top;
    const viewport = box(stream);
    expect(offset).toBeGreaterThan(600);
    for (const count of [
      WINDOWED_STREAM_MIN_ROWS + 1,
      WINDOWED_STREAM_MIN_ROWS,
    ]) {
      view.update({ threads: chatList(count) });
      await nextFrame();
      await nextFrame();
      expect(anchor.isConnected).toBe(true);
      await expect
        .poll(() => Math.abs(box(anchor).top - anchorTop))
        .toBeLessThanOrEqual(SUBPIXEL);
      expect(Math.abs(stream.scrollTop - offset)).toBeLessThanOrEqual(SUBPIXEL);
      expect(
        Math.abs(box(stream).height - viewport.height),
      ).toBeLessThanOrEqual(SUBPIXEL);
      expect(Math.abs(box(stream).width - viewport.width)).toBeLessThanOrEqual(
        SUBPIXEL,
      );
    }
  });

  it('retains a pointer drag source after scrolling a virtual list and commits its project drop', async () => {
    renderHome({ projects: projectList(2), threads: chatList(2_000) });
    const source = chatRow('chat-5');
    const stream = streamRows();
    await expect.poll(() => drawnInside(source, stream)).toBe(true);
    await nextFrame();
    await nextFrame();
    const held = await pickUp(source);
    // A blank-row pointer drag does not focus the row's link or select it.
    expect(source.querySelector('a')).not.toHaveFocus();
    stream.scrollTop = 20_000;
    await expect.poll(() => stream.scrollTop).toBeGreaterThan(10_000);
    await expect.poll(() => drawnInside(source, stream)).toBe(false);
    expect(source.isConnected).toBe(true);
    expect(frame().querySelectorAll('[data-thread-id]').length).toBeLessThan(
      80,
    );

    const project = screen
      .getByRole('link', { name: /Project 01/ })
      .closest('li');
    if (project === null) throw new Error('The project has no drop zone');
    const release = centre(project);
    await carryTo(held, release, () =>
      project.classList.contains('ring-primary'),
    );
    expect(project).toHaveClass('ring-primary');
    mouse(document, 'mouseup', release);
    await expect
      .poll(() => backend.move.mock.calls)
      .toEqual([['chat-5', 'project-0']]);
    expect(backend.setArchived).not.toHaveBeenCalled();
  });

  it('keeps thousands of chats bounded while revealing and focusing the complete row order', async () => {
    renderHome({ threads: chatList(2_000), openThreadId: 'chat-1999' });
    const stream = streamRows();
    await expect
      .poll(() => ({
        inside: drawnInside(chatRow('chat-1999'), stream),
        rowTop: box(chatRow('chat-1999')).top,
        rowBottom: box(chatRow('chat-1999')).bottom,
        streamTop: box(stream).top,
        streamBottom: box(stream).bottom,
        scrollTop: stream.scrollTop,
        scrollHeight: stream.scrollHeight,
      }))
      .toMatchObject({ inside: true });
    expect(frame().querySelectorAll('[data-thread-id]').length).toBeLessThan(
      80,
    );
    const last = chatRow('chat-1999').querySelector('a');
    if (last === null) throw new Error('The last chat has no link');
    // Date headings are not counted as work rows.
    expect(last.closest('li')).toHaveAttribute('aria-setsize', '2000');
    last.focus();
    await userEvent.keyboard('{Home}');
    await expect.poll(() => chatRow('chat-0').querySelector('a')).toHaveFocus();
    await expect.poll(() => drawnInside(chatRow('chat-0'), stream)).toBe(true);
    await expect
      .poll(
        () =>
          box(chatRow('chat-0')).top -
          box(screen.getByRole('heading', { name: 'Today' })).bottom,
      )
      .toBeGreaterThanOrEqual(-SUBPIXEL);
    await userEvent.keyboard('{End}');
    await expect
      .poll(() => chatRow('chat-1999').querySelector('a'))
      .toHaveFocus();
    await expect
      .poll(() => drawnInside(chatRow('chat-1999'), stream))
      .toBe(true);
    await expect
      .poll(() =>
        Math.abs(
          box(screen.getByRole('heading', { name: 'Today' })).top -
            box(stream).top,
        ),
      )
      .toBeLessThanOrEqual(SUBPIXEL);

    // Retain a focused row and its neighbours even when a pointer scrolls away.
    stream.scrollTop = 0;
    await expect.poll(() => drawnInside(chatRow('chat-0'), stream)).toBe(true);
    expect(chatRow('chat-1999').querySelector('a')).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect
      .poll(() => chatRow('chat-1998').querySelector('a'))
      .toHaveFocus();
    expect(frame().querySelectorAll('[data-thread-id]').length).toBeLessThan(
      80,
    );
  });

  it('opens the next chat by Alt+Arrow from the full order outside the rendered window', async () => {
    const rendered = renderHome({
      threads: chatList(2_000),
      openThreadId: 'chat-1000',
    });
    await expect
      .poll(() => drawnInside(chatRow('chat-1000'), streamRows()))
      .toBe(true);
    const opened: string[] = [];
    const capture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[data-indicator-key]');
      if (link === null) return;
      event.preventDefault();
      opened.push(link.pathname);
      // Model the router completing navigation before asserting the new active row.
      rendered.navigateTo('chat-1001');
    };
    frame().addEventListener('click', capture);
    try {
      document.body.focus();
      await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
      await expect
        .poll(() => opened)
        .toEqual([`/dashboard/${ORG}/chat/chat-1001`]);
      await expect
        .poll(() => chatRow('chat-1001').querySelector('a'))
        .toHaveAttribute('aria-current', 'page');
      await expect
        .poll(() => chatRow('chat-1000').querySelector('a'))
        .not.toHaveAttribute('aria-current');
      await expect
        .poll(() => drawnInside(chatRow('chat-1001'), streamRows()))
        .toBe(true);
    } finally {
      frame().removeEventListener('click', capture);
    }
  });

  it('bounds a thousand projects and keeps full-order keyboard navigation in its own scrollport', async () => {
    const projects = projectList(1_000).map((project, index) =>
      Object.assign({}, project, {
        name: `Project ${String(index + 1).padStart(4, '0')}`,
      }),
    );
    renderHome({ projects, threads: chatList(3) });
    const first = screen.getByRole('link', { name: /Project 0001/ });
    const scroller = first.closest<HTMLElement>('.overflow-y-auto');
    if (scroller === null) throw new Error('Projects have no scrollport');
    expect(scroller.querySelectorAll('li').length).toBeLessThan(80);
    expect(box(scroller).height).toBeLessThan(box(frame()).height / 2);
    first.focus();
    await userEvent.keyboard('{End}');
    await expect
      .element(page.getByRole('link', { name: /Project 1000/ }))
      .toHaveFocus();
    const last = screen.getByRole('link', { name: /Project 1000/ });
    expect(last.closest('li')).toHaveAttribute('aria-setsize', '1000');
    await expect.poll(() => drawnInside(last, scroller)).toBe(true);
    await userEvent.keyboard('{ArrowUp}');
    await expect
      .element(page.getByRole('link', { name: /Project 0999/ }))
      .toHaveFocus();
    expect(scroller.querySelectorAll('li').length).toBeLessThan(80);
    expect(drawnInside(chatRow('chat-0'), streamRows())).toBe(true);
    // A non-last row uses indexed alignment rather than the browser's
    // maximum offset. Its list inset must not leave its lower edge clipped.
    await userEvent.keyboard('{Home}');
    await expect
      .element(page.getByRole('link', { name: /Project 0001/ }))
      .toHaveFocus();
    await userEvent.keyboard('{ArrowDown}'.repeat(12));
    await expect
      .element(page.getByRole('link', { name: /Project 0013/ }))
      .toHaveFocus();
    const middle = screen.getByRole('link', { name: /Project 0013/ });
    await expect.poll(() => drawnInside(middle, scroller)).toBe(true);
  });

  it('scrolls stream list and keeps open chat in view', async () => {
    renderHome({
      projects: projectList(4),
      threads: chatList(60),
      openThreadId: 'chat-59',
    });

    const rows = streamRows();
    await expect.poll(() => drawnInside(chatRow('chat-59'), rows)).toBe(true);
    expect(rows.scrollTop).toBeGreaterThan(0);
  });

  it('filters stream list when searching', async () => {
    const { user } = renderHome({
      projects: projectList(2),
      threads: chatList(10),
    });

    const searchInput = screen.getByPlaceholderText(/Search/i);
    await user.type(searchInput, 'Chat 05');
    await nextFrame();

    expect(chatRow('chat-4')).toBeDefined();
  });

  it('puts back a chat released over the stream, never archiving or moving it', async () => {
    renderHome({
      height: 480,
      projects: projectList(2),
      threads: chatList(60),
    });
    // The last chat sits inside the stream once scrolled to its end.
    const stream = streamRows();
    stream.scrollTop = stream.scrollHeight;
    const last = chatRow('chat-59');
    await expect.poll(() => drawnInside(last, stream)).toBe(true);

    // A short drag down that stays over the stream: the pointer stays inside the list.
    const held = await pickUp(last);
    const release = { x: held.x, y: box(stream).bottom - 3 };
    await carryTo(held, release, () => false);
    mouse(document, 'mouseup', release);
    await nextFrame();
    await nextFrame();

    expect(backend.setArchived).not.toHaveBeenCalled();
    expect(backend.move).not.toHaveBeenCalled();
  });

  // Drop targets are measured when a drag starts and again as the pointer
  // moves, never at rest: a project row must still take the chat dropped on
  // it.
  it('files a chat dropped on a project into it', async () => {
    renderHome({ projects: projectList(4), threads: chatList(8) });
    const project = screen.getByRole('link', { name: /Project 03/ });
    const held = await pickUp(chatRow('chat-5'));
    const target = centre(project);
    await carryTo(held, target, () =>
      Boolean(project.closest('li')?.className.includes('ring-primary')),
    );
    mouse(document, 'mouseup', target);
    await expect
      .poll(() => backend.move.mock.calls.at(-1))
      .toEqual(['chat-5', 'project-2']);
    expect(backend.setArchived).not.toHaveBeenCalled();
  });

  it("marks an unread chat with a dot in the organization's accent", () => {
    // `--primary` is what the branding provider sets from an org's accent;
    // the dot once stayed a fixed blue whatever the org picked.
    document.documentElement.style.setProperty('--primary', '300 100% 32%');
    renderHome({ threads: chatList(3), unread: ['chat-1'] });

    const dot = within(chatRow('chat-1')).getByText(
      'Unread',
    ).nextElementSibling;
    expect(dot).toBeInstanceOf(HTMLElement);
    expect(getComputedStyle(dot as HTMLElement).backgroundColor).toBe(
      'rgb(163, 0, 163)',
    );
  });
});

/**
 * Past `WINDOWED_STREAM_MIN_ROWS` the stream mounts only the rows near its
 * view. A stream of 600 chats mounted 600 rows — each with its menu, drag
 * handle, age and link — on every load and every search.
 */
describe('a long Home stream in Chromium', () => {
  function mountedRows() {
    return document.querySelectorAll('[data-thread-id]').length;
  }

  function rowLink(threadId: string) {
    return chatRow(threadId).querySelector('a[data-indicator-key]');
  }

  it('mounts every row of a stream at the threshold', () => {
    renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    expect(mountedRows()).toBe(WINDOWED_STREAM_MIN_ROWS);
  });

  // Each list once rendered one element up to 60 rows and another past them,
  // so a crossing replaced the list: every row remounted, with whatever was
  // open or focused in it, and the list faded in again (#4414).
  it('keeps the list, the rows in view and the focus as live rows cross the threshold, and fades in once', async () => {
    const view = renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    const list = streamList();
    await fadedIn(list);
    const link = rowLink('chat-5');
    if (!(link instanceof HTMLElement)) throw new Error('No row');
    link.focus();
    let before = drawnChatRows();
    await crossTheWindowThreshold(view, () => {
      const after = drawnChatRows();
      const { kept, remounted } = survivors(before, after);
      expect(remounted).toEqual([]);
      expect(kept.length).toBeGreaterThan(10);
      expect(streamList().getAnimations()).toEqual([]);
      expect(streamList()).toBe(list);
      expect(link).toHaveFocus();
      before = after;
    });
  });

  it("keeps a row's open menu, and the focus in it, as live rows cross the threshold", async () => {
    const view = renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    const list = streamList();
    const row = chatRow('chat-5');
    await page
      .elementLocator(within(row).getByRole('button', { name: 'More actions' }))
      .click();
    const menu = await screen.findByRole('menu');
    await expect.poll(() => menu.contains(document.activeElement)).toBe(true);
    await crossTheWindowThreshold(view, () => {
      expect(chatRow('chat-5')).toBe(row);
      expect(menu.isConnected).toBe(true);
      expect(menu.contains(document.activeElement)).toBe(true);
      expect(streamList()).toBe(list);
    });
  });

  it("keeps a row's delete confirmation, and the focus in it, as live rows cross the threshold", async () => {
    const view = renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    const list = streamList();
    const row = chatRow('chat-5');
    await page
      .elementLocator(within(row).getByRole('button', { name: 'More actions' }))
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect
      .element(page.getByRole('button', { name: 'Delete chat' }))
      .toBeVisible();
    const dialog = screen.getByRole('dialog');
    await expect.poll(() => dialog.contains(document.activeElement)).toBe(true);
    await crossTheWindowThreshold(view, () => {
      expect(chatRow('chat-5')).toBe(row);
      expect(dialog.isConnected).toBe(true);
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(streamList()).toBe(list);
    });
  });

  // A fresh chat's draft row counts as a row: opening one beside 60 chats
  // crosses the threshold too, and leaving it crosses back.
  it('keeps a rename left with its error while a fresh chat takes the stream across the threshold and back', async () => {
    const view = renderHome({ threads: chatList(WINDOWED_STREAM_MIN_ROWS) });
    const list = streamList();
    const row = chatRow('chat-5');
    await page
      .elementLocator(within(row).getByRole('button', { name: 'More actions' }))
      .click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = screen.getByRole('textbox', { name: 'Rename' });
    await page.elementLocator(input).fill('');
    // Leaving the empty field asks for a title and keeps the field open.
    await page.elementLocator(screen.getByPlaceholderText(/Search/i)).click();
    await expect
      .poll(() => input)
      .toHaveAccessibleErrorMessage('Enter a chat title.');
    const unchanged = () => {
      expect(chatRow('chat-5')).toBe(row);
      expect(input.isConnected).toBe(true);
      expect(input).toHaveValue('');
      expect(input).toHaveAccessibleErrorMessage('Enter a chat title.');
      expect(streamList()).toBe(list);
    };
    const draftRow = () =>
      streamList().querySelector(`[data-indicator-key="${DRAFT_ROW_KEY}"]`);

    // A fresh chat opens: its draft row leads 60 chats, 61 rows.
    view.startChat();
    await expect
      .poll(() => mountedRows())
      .toBeLessThan(WINDOWED_STREAM_MIN_ROWS);
    unchanged();
    expect(draftRow()).not.toBeNull();

    // Another chat opens: the draft row goes, 60 rows.
    view.navigateTo('chat-0');
    expect(mountedRows()).toBe(WINDOWED_STREAM_MIN_ROWS);
    unchanged();
    expect(draftRow()).toBeNull();
  });

  it('mounts only the rows near the view, each telling its place in the whole stream', async () => {
    renderHome({ threads: chatList(400) });
    await expect.poll(() => mountedRows()).toBeGreaterThan(10);
    expect(mountedRows()).toBeLessThan(80);
    expect(chatRow('chat-0')).toHaveAttribute('aria-posinset', '1');
    expect(chatRow('chat-0')).toHaveAttribute('aria-setsize', '400');
    // The rows sit one under the other, a pixel apart, as the whole list
    // would place them.
    const first = box(chatRow('chat-0'));
    const second = box(chatRow('chat-1'));
    expect(second.top - first.bottom).toBeCloseTo(1, 0);
  });

  it('mounts the rows a scroll reaches, at their place, and keeps the open chat with its neighbours', async () => {
    renderHome({ threads: chatList(400), openThreadId: 'chat-10' });
    const stream = streamRows();
    await expect.poll(() => mountedRows()).toBeGreaterThan(10);
    const expectedHeight = stream.scrollHeight;

    stream.scrollTop = stream.scrollHeight;
    await expect
      .poll(() => document.querySelector('[data-thread-id="chat-399"]'))
      .not.toBeNull();
    await expect
      .poll(() => drawnInside(chatRow('chat-399'), stream))
      .toBe(true);
    // The far end of the list ends where the list does.
    expect(box(chatRow('chat-399')).bottom).toBeLessThanOrEqual(
      box(stream).bottom + SUBPIXEL,
    );
    expect(Math.abs(stream.scrollHeight - expectedHeight)).toBeLessThan(
      expectedHeight * 0.1,
    );
    // The open chat and its neighbours stay mounted for ⌥↑/⌥↓ and the
    // highlight; a row between them and the view does not.
    for (const id of ['chat-9', 'chat-10', 'chat-11']) {
      expect(document.querySelector(`[data-thread-id="${id}"]`)).not.toBeNull();
    }
    expect(document.querySelector('[data-thread-id="chat-200"]')).toBeNull();
    expect(mountedRows()).toBeLessThan(90);
  });

  it('walks the whole stream with the arrow keys, Home and End', async () => {
    renderHome({ threads: chatList(400) });
    await expect.poll(() => rowLink('chat-0')).not.toBeNull();
    const firstLink = rowLink('chat-0');
    if (!(firstLink instanceof HTMLElement)) throw new Error('No first row');
    firstLink.focus();

    await userEvent.keyboard('{End}');
    await expect
      .poll(() =>
        document.activeElement
          ?.closest('[data-thread-id]')
          ?.getAttribute('data-thread-id'),
      )
      .toBe('chat-399');

    await userEvent.keyboard('{ArrowUp}');
    await expect
      .poll(() =>
        document.activeElement
          ?.closest('[data-thread-id]')
          ?.getAttribute('data-thread-id'),
      )
      .toBe('chat-398');

    await userEvent.keyboard('{Home}');
    await expect
      .poll(() =>
        document.activeElement
          ?.closest('[data-thread-id]')
          ?.getAttribute('data-thread-id'),
      )
      .toBe('chat-0');
  });

  it('keeps a focused row mounted, and focused, while the stream scrolls away', async () => {
    renderHome({ threads: chatList(400) });
    await expect.poll(() => rowLink('chat-5')).not.toBeNull();
    const link = rowLink('chat-5');
    if (!(link instanceof HTMLElement)) throw new Error('No row');
    link.focus();

    const stream = streamRows();
    stream.scrollTop = stream.scrollHeight;
    await expect
      .poll(() => document.querySelector('[data-thread-id="chat-399"]'))
      .not.toBeNull();
    expect(document.querySelector('[data-thread-id="chat-5"]')).not.toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it('keeps a row, its open menu and its delete confirmation while the stream scrolls away', async () => {
    renderHome({ threads: chatList(400) });
    await expect.poll(() => rowLink('chat-5')).not.toBeNull();
    const row = chatRow('chat-5');
    const stream = streamRows();
    const scrollAway = async () => {
      stream.scrollTop = stream.scrollHeight;
      // The first and last rows are always mounted: a row from the middle
      // of the far end, and none from the near end, says the window moved.
      await expect
        .poll(() => document.querySelector('[data-thread-id="chat-390"]'))
        .not.toBeNull();
      await expect
        .poll(() => document.querySelector('[data-thread-id="chat-10"]'))
        .toBeNull();
      expect(row.isConnected).toBe(true);
    };

    // Both live in portals; their focus events still reach the row.
    await page
      .elementLocator(within(row).getByRole('button', { name: 'More actions' }))
      .click();
    await expect.element(page.getByRole('menu')).toBeInTheDocument();
    await scrollAway();
    expect(screen.getByRole('menu')).toBeInTheDocument();

    stream.scrollTop = 0;
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect
      .element(page.getByRole('button', { name: 'Delete chat' }))
      .toBeVisible();
    await scrollAway();
    expect(
      screen.getByRole('button', { name: 'Delete chat' }),
    ).toBeInTheDocument();
  });

  it("hands each row the same placement while a fresh chat's draft row leads", async () => {
    const groups: HomeGroup[] = [
      {
        key: 'today',
        items: Array.from({ length: 200 }, (_, index) => ({
          kind: 'chat' as const,
          id: `chat-${index}`,
          title: `Chat ${index}`,
          activityAt: 0,
          unread: false,
          generating: false,
          shared: false,
        })),
      },
    ];
    const placements = new Map<string, HomeRowPlacement | undefined>();
    function Stream() {
      const [scrollElement, setScrollElement] = useState<HTMLElement | null>(
        null,
      );
      return (
        <div ref={setScrollElement} style={{ height: 400, overflow: 'auto' }}>
          <HomeStream
            groups={groups}
            // A new element on every render, as the panel builds it.
            draft={<li>Draft</li>}
            renderRow={(item, placement) => {
              placements.set(item.id, placement);
              return (
                <li
                  key={item.id}
                  ref={placement?.measureRef}
                  data-index={placement?.index}
                >
                  {item.title}
                </li>
              );
            }}
            ariaLabel="Stream"
            scrollElement={scrollElement}
            activeKey={null}
          />
        </div>
      );
    }
    const { rerender } = render(<Stream />);
    await expect.poll(() => placements.get('chat-0')).toBeDefined();
    const placement = placements.get('chat-0');

    // The panel renders again, the draft row with it: a memoized row must
    // not.
    rerender(<Stream />);
    expect(placements.get('chat-0')).toBe(placement);
  });
});

describe('a long PROJECTS list in Chromium', () => {
  // Three digits, so 300 names sort in their numeric order.
  function manyProjects(count: number): ChatProjectSummary[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${String(index + 1).padStart(3, '0')}`,
    }));
  }

  function projectRows() {
    return screen
      .getByRole('region', { name: 'Projects' })
      .querySelectorAll('li[data-index]');
  }

  function projectsList() {
    const list = screen
      .getByRole('region', { name: 'Projects' })
      .querySelector('ul[role="list"]');
    if (!(list instanceof HTMLElement)) throw new Error('No projects list');
    return list;
  }

  function projectsScroller() {
    const scroller = projectsList().parentElement;
    if (!(scroller instanceof HTMLElement)) throw new Error('No scroller');
    return scroller;
  }

  /** The project rows in the page, by project. */
  function drawnProjectRows() {
    return new Map(
      [...projectRows()].map((row) => [
        row
          .querySelector('[data-indicator-key]')
          ?.getAttribute('data-indicator-key') ?? '',
        row,
      ]),
    );
  }

  /**
   * Takes 60 projects across the window threshold and back, the way live
   * reads do: a project created elsewhere, sorting first, makes 61 rows, of
   * which only those near the view are mounted; its leaving makes 60 again,
   * all of them mounted. `check` runs on each side. PROJECTS is drawn by the
   * stream's list, so it windows past the stream's threshold.
   */
  async function crossTheProjectsThreshold(
    view: ReturnType<typeof renderHome>,
    check: () => void,
  ) {
    view.update({
      projects: [
        { id: 'project-new', name: 'Project 000' },
        ...manyProjects(WINDOWED_STREAM_MIN_ROWS),
      ],
    });
    await expect
      .poll(() => projectRows().length)
      .toBeLessThan(WINDOWED_STREAM_MIN_ROWS);
    check();
    view.update({ projects: manyProjects(WINDOWED_STREAM_MIN_ROWS) });
    expect(projectRows()).toHaveLength(WINDOWED_STREAM_MIN_ROWS);
    check();
  }

  it('mounts every project of a list at the threshold', () => {
    renderHome({
      projects: manyProjects(WINDOWED_STREAM_MIN_ROWS),
      threads: chatList(3),
    });
    expect(projectRows()).toHaveLength(WINDOWED_STREAM_MIN_ROWS);
  });

  it('keeps the list, the rows in view and the focus as projects cross the threshold, and fades in once', async () => {
    const view = renderHome({
      projects: manyProjects(WINDOWED_STREAM_MIN_ROWS),
      threads: chatList(3),
    });
    const list = projectsList();
    await fadedIn(list);
    const link = screen.getByRole('link', { name: /Project 005/ });
    link.focus();
    let before = drawnProjectRows();
    await crossTheProjectsThreshold(view, () => {
      const after = drawnProjectRows();
      const { kept, remounted } = survivors(before, after);
      expect(remounted).toEqual([]);
      expect(kept.length).toBeGreaterThan(5);
      expect(projectsList().getAnimations()).toEqual([]);
      expect(projectsList()).toBe(list);
      expect(link).toHaveFocus();
      before = after;
    });
  });

  it("keeps a project's open menu, and the focus in it, as projects cross the threshold", async () => {
    const view = renderHome({
      projects: manyProjects(WINDOWED_STREAM_MIN_ROWS),
      threads: chatList(3),
    });
    const list = projectsList();
    const row = () =>
      screen.getByRole('link', { name: /Project 005/ }).closest('li');
    const opened = row();
    await page
      .elementLocator(
        screen.getByRole('button', { name: 'Actions for Project 005' }),
      )
      .click();
    const menu = await screen.findByRole('menu');
    await expect.poll(() => menu.contains(document.activeElement)).toBe(true);
    await crossTheProjectsThreshold(view, () => {
      expect(row()).toBe(opened);
      expect(menu.isConnected).toBe(true);
      expect(menu.contains(document.activeElement)).toBe(true);
      expect(projectsList()).toBe(list);
    });
  });

  it('mounts only the projects near the view, and every one a scroll or End reaches', async () => {
    renderHome({ projects: manyProjects(300), threads: chatList(3) });
    await expect.poll(() => projectRows().length).toBeGreaterThan(5);
    expect(projectRows().length).toBeLessThan(60);
    const first = projectRows()[0];
    expect(first).toHaveAttribute('aria-posinset', '1');
    expect(first).toHaveAttribute('aria-setsize', '300');

    const scroller = projectsScroller();
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('link', { name: /Project 300/ }))
      .not.toBeNull();
    expect(projectRows().length).toBeLessThan(60);

    scroller.scrollTop = 0;
    const firstLink = await screen.findByRole('link', { name: /Project 001/ });
    firstLink.focus();
    await userEvent.keyboard('{End}');
    await expect
      .poll(() => document.activeElement?.textContent)
      .toContain('Project 300');
  });

  it('keeps the open project mounted wherever the list scrolls', async () => {
    renderHome({ projects: manyProjects(300), threads: chatList(3) });
    backend.location = {
      pathname: `/dashboard/${ORG}/projects/project-150`,
      search: {},
    };
    cleanup();
    render(
      <div
        data-testid="frame"
        style={{ height: 640 }}
        className="bg-background flex w-70 flex-col overflow-hidden"
      >
        <HomeNavigator organizationId={ORG} />
      </div>,
    );
    await expect
      .poll(() => screen.queryByRole('link', { name: /Project 151/ }))
      .not.toBeNull();
    expect(screen.getByRole('link', { name: /Project 151/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const scroller = projectsScroller();
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('link', { name: /Project 300/ }))
      .not.toBeNull();
    expect(
      screen.getByRole('link', { name: /Project 151/ }),
    ).toBeInTheDocument();
  });
});

/**
 * Task rows use the shared age class and keep their ages visible on hover
 * (chat actions replace ages on desktop). The active fill is a sibling
 * SlidingHighlight, not a row ancestor.
 */
describe.each(['light', 'dark'] as const)(
  'rendered Home row ages (%s)',
  (theme) => {
    it.each([
      [1280, undefined],
      [1280, '#000000'],
      [1280, '#056CFF'],
      [390, undefined],
      [390, '#000000'],
      [390, '#056CFF'],
    ] as const)(
      'clears AA and axe for visible row ages at %ipx (accent %s)',
      async (width, accent) => {
        await resizeViewport(width, 800);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const palette = accent ? deriveAccentPalette(accent, theme) : undefined;
        const now = Date.now();
        backend.home = {
          ...homeData([], []),
          items: Array.from({ length: 3 }, (_, index): HomeItem => ({
            kind: 'task',
            id: `task-${index}`,
            title: `Task ${index + 1}`,
            activityAt: now - index * 60_000,
            unread: false,
            status: 'in_progress',
            awaitingMyReview: false,
          })),
        } satisfies HomeData;
        backend.location = {
          pathname: `/dashboard/${ORG}/tasks/task-0`,
          search: {},
        };
        localStorage.setItem(`home-view-${ORG}`, JSON.stringify('tasks'));
        const { container } = render(
          <AccentColorProvider accentColor={palette?.text}>
            <div className="bg-background flex h-160" style={{ width: 280 }}>
              {width >= 768 ? (
                <HomePanelProvider organizationId={ORG}>
                  <HomePanel organizationId={ORG} />
                </HomePanelProvider>
              ) : (
                <HomeNavigator organizationId={ORG} variant="screen" />
              )}
            </div>
          </AccentColorProvider>,
        );
        const current = screen.getByRole('link', { name: /Task 1/ });
        const idle = screen.getByRole('link', { name: /Task 2/ });
        expect(current).toHaveAttribute('aria-current', 'page');
        expect(idle).not.toHaveAttribute('aria-current');
        const scroller = streamRows();
        const highlight = scroller.querySelector(
          ':scope > span[aria-hidden="true"]',
        );
        if (!(highlight instanceof HTMLElement))
          throw new Error('No Home highlight');
        const highlightElement: HTMLElement = highlight;

        function ageOf(row: HTMLElement) {
          const age = row.querySelector('span.tabular-nums');
          if (!(age instanceof HTMLElement)) throw new Error('No Home row age');
          expect(age.textContent).not.toBe('');
          return age;
        }

        function statusOf(row: HTMLElement) {
          const status = within(row).getByText('In progress');
          expect(status).toHaveClass('truncate');
          return status;
        }

        function measuredContrast(
          row: HTMLElement,
          highlighted: boolean,
          text: HTMLElement = ageOf(row),
        ) {
          const age = text;
          const layers: Element[] = [];
          for (
            let node: Element | null = age;
            node;
            node = node.parentElement
          ) {
            layers.push(node);
          }
          let background = '#ffffff';
          for (const node of layers.reverse()) {
            background = painted(
              getComputedStyle(node).backgroundColor,
              background,
            );
            if (highlighted && node === scroller) {
              const style = getComputedStyle(highlightElement);
              background = painted(
                style.backgroundColor,
                background,
                Number(style.opacity),
              );
            }
          }
          const style = getComputedStyle(age);
          expect(style.opacity).toBe('1');
          expect(box(age).width).toBeGreaterThan(0);
          expect(box(age).height).toBeGreaterThan(0);
          const ratio = contrastRatio(
            painted(style.color, background, Number(style.opacity)),
            background,
          );
          console.info(
            'TALE-452 rendered contrast',
            JSON.stringify({
              theme,
              width,
              accent: accent ?? null,
              state: highlighted
                ? 'highlighted'
                : row.matches(':hover')
                  ? 'hovered'
                  : 'idle',
              text: text.textContent,
              foreground: style.color,
              background,
              opacity: style.opacity,
              ratio,
            }),
          );
          return ratio;
        }

        async function assertPanel() {
          // Wait for the real highlight to settle underneath the current age.
          await expect
            .poll(() => {
              const fill = box(highlightElement);
              const age = box(ageOf(current));
              return (
                fill.left <= age.left &&
                fill.right >= age.right &&
                fill.top <= age.top &&
                fill.bottom >= age.bottom &&
                getComputedStyle(highlightElement).opacity === '1'
              );
            })
            .toBe(true);
          // The list fades in as a whole and rows ease between hover states.
          // axe reads the opacity of every ancestor, so colours are judged
          // once nothing is mid-flight, not 200 ms of wall clock after render.
          await Promise.allSettled(
            document.getAnimations().map((animation) => animation.finished),
          );
          expect(measuredContrast(idle, false)).toBeGreaterThanOrEqual(4.5);
          expect(measuredContrast(current, true)).toBeGreaterThanOrEqual(4.5);
          expect(
            measuredContrast(idle, false, statusOf(idle)),
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            measuredContrast(current, true, statusOf(current)),
          ).toBeGreaterThanOrEqual(4.5);
          // Whole neutral Home panel; additional branded coverage targets
          // ages, the repaired ink contract, rather than unrelated labels.
          const ageNodes = [ageOf(idle), ageOf(current)];
          const checkedNodes = [...ageNodes, statusOf(idle), statusOf(current)];
          const result = await axe.run(palette ? checkedNodes : container, {
            runOnly: ['color-contrast'],
            elementRef: true,
          });
          const plainCheck = (check: axe.CheckResult) => ({
            id: check.id,
            impact: check.impact,
            message: check.message,
            data: check.data,
            relatedNodes: check.relatedNodes?.map(
              (related: axe.RelatedNode) => ({
                html: related.html,
                target: related.target,
              }),
            ),
          });
          const plainNode = (node: axe.NodeResult) => ({
            any: node.any?.map(plainCheck),
            all: node.all?.map(plainCheck),
            none: node.none?.map(plainCheck),
            html: node.html,
            impact: node.impact,
            target: node.target,
            failureSummary: node.failureSummary,
          });
          const plainRule = (rule: axe.Result) => ({
            id: rule.id,
            impact: rule.impact,
            help: rule.help,
            helpUrl: rule.helpUrl,
            description: rule.description,
            tags: rule.tags,
            nodes: rule.nodes?.map(plainNode),
          });
          console.info(
            'TALE-452 axe',
            JSON.stringify({
              theme,
              width,
              accent: accent ?? null,
              hovered: idle.matches(':hover'),
              scope: palette ? 'row ages and status' : 'whole Home panel',
              violations: result.violations.map(plainRule),
              agePasses: result.passes
                .flatMap((rule) => rule.nodes)
                .filter((node) => ageNodes.includes(node.element!))
                .map(plainNode),
            }),
          );
          expect(result.violations).toEqual([]);
          expect(
            result.passes.some((rule) => rule.id === 'color-contrast'),
          ).toBe(true);
          // A visible age must be evaluated, not deferred to manual inspection.
          for (const age of checkedNodes) {
            expect(
              result.passes
                .flatMap((rule) => rule.nodes)
                .some((node) => node.element === age),
            ).toBe(true);
          }
        }

        await page
          .elementLocator(screen.getByPlaceholderText(/Search/i))
          .hover();
        await assertPanel();
        await page.elementLocator(idle).hover();
        await expect.poll(() => idle.matches(':hover')).toBe(true);
        // Wait for the hover fill transition before measuring it.
        await expect
          .poll(() => getComputedStyle(idle).backgroundColor)
          .not.toBe('rgba(0, 0, 0, 0)');
        await expect.poll(() => idle.getAnimations().length).toBe(0);
        await assertPanel();

        if (theme === 'light' && !palette) {
          // Negative control: the pre-#4171 age class on the same real DOM
          // must fail both the measured AA floor and axe. Restore in finally.
          const age = ageOf(idle);
          const repairedClass = age.className;
          try {
            age.className =
              'text-muted-foreground/80 shrink-0 text-[11px] leading-5 tabular-nums transition-opacity duration-150';
            expect(measuredContrast(idle, false)).toBeLessThan(4.5);
            const old = await axe.run(age, {
              runOnly: ['color-contrast'],
              elementRef: true,
            });
            expect(
              old.violations.some(
                (rule) =>
                  rule.id === 'color-contrast' &&
                  rule.nodes.some((node) => node.element === age),
              ),
            ).toBe(true);
          } finally {
            age.className = repairedClass;
          }
          await assertPanel();
        }
      },
      15_000,
    );
  },
);

describe('desktop Home panel resizing', () => {
  function mountPanel() {
    backend.home = homeData([], []);
    backend.location = { pathname: `/dashboard/${ORG}/chat`, search: {} };
    return render(
      <div className="flex h-160">
        <HomePanelProvider organizationId={ORG}>
          <HomePanel organizationId={ORG} />
        </HomePanelProvider>
      </div>,
    );
  }

  it('drags the right edge, clamps width, and remembers it after remount', async () => {
    const view = mountPanel();
    const separator = screen.getByRole('separator');
    const panel = document.getElementById('home-panel')!;
    expect(box(panel).width).toBe(280);
    mouse(separator, 'mousedown', { x: box(panel).right - 2, y: 100 });
    await expect.poll(() => document.body.style.cursor).toBe('col-resize');
    mouse(document, 'mousemove', { x: box(panel).left + 380, y: 100 });
    await nextFrame();
    await expect.poll(() => box(panel).width).toBe(380);
    mouse(document, 'mousemove', { x: box(panel).left + 900, y: 100 });
    await nextFrame();
    await expect.poll(() => box(panel).width).toBe(480);
    mouse(document, 'mouseup', { x: 900, y: 100 });
    await nextFrame();
    view.unmount();
    mountPanel();
    expect(screen.getByRole('separator')).toHaveAttribute(
      'aria-valuenow',
      '480',
    );
  });

  it('reads each organization width without overwriting the previous one', async () => {
    window.localStorage.setItem(`home-panel-width-${ORG}`, '360');
    window.localStorage.setItem('home-panel-width-org-other', '420');
    backend.home = homeData([], []);
    backend.location = { pathname: `/dashboard/${ORG}/chat`, search: {} };
    const panelFor = (organizationId: string) => (
      <div className="flex h-160">
        <HomePanelProvider organizationId={organizationId}>
          <HomePanel organizationId={organizationId} />
        </HomePanelProvider>
      </div>
    );
    const view = render(panelFor(ORG));
    const first = screen.getByRole('separator');
    expect(first).toHaveAttribute('aria-valuenow', '360');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(first).toHaveAttribute('aria-valuenow', '380');
    await expect
      .poll(() => window.localStorage.getItem(`home-panel-width-${ORG}`))
      .toBe('380');
    backend.location = { pathname: '/dashboard/org-other/chat', search: {} };
    view.rerender(panelFor('org-other'));
    expect(screen.getByRole('separator')).toHaveAttribute(
      'aria-valuenow',
      '420',
    );
    expect(window.localStorage.getItem(`home-panel-width-${ORG}`)).toBe('380');
    expect(window.localStorage.getItem('home-panel-width-org-other')).toBe(
      '420',
    );
  });

  it('stops resizing when the browser loses the drag', async () => {
    mountPanel();
    const panel = document.getElementById('home-panel')!;
    const separator = screen.getByRole('separator');
    mouse(separator, 'mousedown', { x: box(panel).right - 2, y: 100 });
    await expect.poll(() => document.body.style.cursor).toBe('col-resize');
    window.dispatchEvent(new Event('blur'));
    await nextFrame();
    expect(document.body.style.cursor).toBe('');
    mouse(document, 'mousemove', { x: box(panel).left + 420, y: 100 });
    await nextFrame();
    expect(separator).toHaveAttribute('aria-valuenow', '280');
  });

  it.each([
    ['light', '#0066CC'],
    ['dark', '#0066CC'],
    ['light', '#0B0B2A'],
    ['dark', '#0B0B2A'],
    ['light', '#443366'],
    ['dark', '#443366'],
    ['light', '#F5F5F0'],
    ['dark', '#F5F5F0'],
  ] as const)(
    'keeps the divider focus ring distinct in %s with accent %s',
    async (theme, accent) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const palette = deriveAccentPalette(accent, theme);
      document.documentElement.style.setProperty('--primary', palette.textHsl);
      document.documentElement.style.setProperty('--ring', palette.textHsl);
      mountPanel();
      const separator = screen.getByRole('separator');
      separator.focus();
      await userEvent.keyboard('{ArrowRight}');
      const style = getComputedStyle(separator);
      const ring = style.boxShadow
        .split(/,(?![^(]*\))/)
        .map((layer) => layer.trim())
        .find((layer) => layer.endsWith('0px 0px 0px 2px inset'));
      expect(ring).toBeDefined();
      const ringColor = ring!.replace(' 0px 0px 0px 2px inset', '');
      const background = painted(
        style.backgroundColor,
        painted(
          getComputedStyle(document.getElementById('home-panel')!)
            .backgroundColor,
        ),
      );
      expect(
        contrastRatio(painted(ringColor, background), background),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it('resizes with arrow keys and hides the handle on mobile or collapse', async () => {
    mountPanel();
    const separator = screen.getByRole('separator');
    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{ArrowLeft}');
    expect(separator).toHaveAttribute('aria-valuenow', '280');
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'Backslash',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }),
    );
    await nextFrame();
    expect(screen.queryByRole('separator')).toBeNull();
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'Backslash',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }),
    );
    await nextFrame();
    await resizeViewport(390, 800);
    expect(screen.queryByRole('separator')).toBeNull();
  });
});

describe('Home screen on a phone', () => {
  it('keeps the archive control above the mobile navigation', async () => {
    await resizeViewport(390, 844);
    renderHome({
      variant: 'screen',
      width: 390,
      height: 844,
      threads: chatList(20),
    });
    const archive = screen.getByRole('button', {
      name: 'Archived',
    });
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(box(archive).bottom).toBeLessThan(box(nav).top);
  });

  it('fits 390px wide when narrowed, with tappable controls', async () => {
    await resizeViewport(390, 800);
    const longName =
      'Quarterly planning and launch readiness review for the whole organisation';
    const projects = projectList(3);
    projects[0] = { id: 'project-0', name: longName };
    const threads = chatList(6, { projectId: 'project-0', count: 2 });
    const { user } = renderHome({
      variant: 'screen',
      width: 390,
      height: 760,
      projects,
      threads,
      openThreadId: 'none',
    });

    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    const project = within(
      screen.getByRole('region', { name: 'Projects' }),
    ).getByRole('button', { name: /^(?!Actions for).*Quarterly/ });
    await user.click(project);
    await nextFrame();

    // Only the project's two chats are left.
    expect(
      within(
        screen.getByRole('list', {
          name: 'Your chats, tasks and conversations',
        }),
      ).getAllByRole('link'),
    ).toHaveLength(2);

    const controls = [project, screen.getByPlaceholderText(/Search/i)];
    const frameBox = frame().getBoundingClientRect();
    for (const control of controls) {
      const controlBox = control.getBoundingClientRect();
      // Inside the screen, and tall enough for a thumb: the 24px WCAG 2.2
      // minimum with room to spare.
      expect(controlBox.left).toBeGreaterThanOrEqual(frameBox.left - SUBPIXEL);
      expect(controlBox.right).toBeLessThanOrEqual(frameBox.right + SUBPIXEL);
      expect(controlBox.height).toBeGreaterThanOrEqual(24);
    }
    expect(frame().scrollWidth).toBeLessThanOrEqual(frame().clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});

/**
 * The view switcher in the row it shares with New chat: the narrowest and
 * widest desktop panel, and a phone's Home screen, in every language the app
 * ships, with and without an Inbox. Whichever view is open, its name shows in
 * full beside its icon, every other view is its icon alone, and the row keeps
 * New chat inside the panel.
 */
describe('the Home view switcher in its row', () => {
  afterEach(async () => {
    await forgetSavedLocale();
  });

  function labelFrames() {
    return screen.getAllByRole('radio').map((radio) => {
      // oxlint-disable-next-line testing-library/no-node-access -- the label's frame has no role
      const labelFrame = radio.querySelector(
        '[data-slot="segmented-label-frame"]',
      );
      // oxlint-disable-next-line testing-library/no-node-access -- see above
      const label = labelFrame?.querySelector('[data-slot="segmented-label"]');
      if (
        !(labelFrame instanceof HTMLElement) ||
        !(label instanceof HTMLElement)
      ) {
        throw new Error('A view has no label frame');
      }
      return { radio, labelFrame, label };
    });
  }

  it.each([
    ['panel', 280, 'en'],
    ['panel', 280, 'de'],
    ['panel', 280, 'fr'],
    ['panel', 480, 'en'],
    ['panel', 480, 'de'],
    ['panel', 480, 'fr'],
    ['screen', 360, 'en'],
    ['screen', 360, 'de'],
    ['screen', 360, 'fr'],
  ] as const)(
    'names the open view in full at %s %ipx in %s, with three views or four',
    async (variant, width, locale) => {
      await resizeViewport(variant === 'panel' ? 1280 : width, 800);
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      for (const hasInbox of [false, true]) {
        const views = hasInbox
          ? ['all', 'chats', 'tasks', 'inbox']
          : ['all', 'chats', 'tasks'];
        for (const view of views) {
          localStorage.setItem(`home-view-${ORG}`, JSON.stringify(view));
          localStorage.setItem(
            `home-panel-width-${ORG}`,
            JSON.stringify(width),
          );
          backend.home = {
            ...homeData([], chatList(3)),
            hasInbox,
            attention: { chats: 2, tasks: 1, inbox: 3 },
          } satisfies HomeData;
          backend.location = {
            pathname: `/dashboard/${ORG}/chat/chat-0`,
            search: {},
          };
          render(
            <div
              data-testid="host"
              className="bg-background flex h-160"
              style={{ width }}
            >
              {variant === 'panel' ? (
                <HomePanelProvider organizationId={ORG}>
                  <HomePanel organizationId={ORG} />
                </HomePanelProvider>
              ) : (
                <HomeNavigator organizationId={ORG} variant="screen" />
              )}
            </div>,
          );
          const name = i18n.t(`home:views.${view}`);
          const frames = labelFrames();
          expect(frames).toHaveLength(views.length);
          for (const { radio, labelFrame, label: text } of frames) {
            const open = radio.getAttribute('aria-checked') === 'true';
            expect(radio, text.textContent ?? '').toHaveAccessibleName(
              new RegExp(`^${text.textContent ?? ''}`),
            );
            if (open) {
              // Shown, and never cut: its frame holds the whole word.
              expect(text).toHaveTextContent(name);
              expect(labelFrame).toHaveAttribute('data-shown', 'true');
              expect(box(labelFrame).width).toBeGreaterThanOrEqual(
                box(text).width - SUBPIXEL,
              );
            } else {
              expect(labelFrame).toHaveAttribute('data-shown', 'false');
            }
          }
          // Every view stays in the row: short of New chat, which keeps its
          // place at the row's end inside the panel, or of a phone's edge.
          const host = box(screen.getByTestId('host'));
          const [newChat] =
            variant === 'panel'
              ? screen.getAllByRole('link', { name: i18n.t('home:newChat') })
              : [];
          for (const { radio } of frames) {
            expect(box(radio).left).toBeGreaterThanOrEqual(host.left);
            expect(box(radio).right).toBeLessThanOrEqual(
              newChat === undefined ? host.right : box(newChat).left,
            );
          }
          if (newChat !== undefined) {
            expect(box(newChat).right).toBeLessThanOrEqual(host.right);
          }
          cleanup();
        }
      }
    },
  );
});

it('isolates Home shortcuts from a focused Search dialog button in Chromium', async () => {
  renderHome({ threads: chatList(3) });
  const next = await screen.findByRole('link', { name: /Chat 02/ });
  const click = vi.spyOn(next, 'click').mockImplementation(() => {});
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  expect(click).toHaveBeenCalledOnce();
  click.mockClear();
  const modal = render(
    <Dialog open onOpenChange={() => {}} title="Search">
      <button>Chats</button>
      <input aria-label="Search text" />
    </Dialog>,
  );
  const button = await screen.findByRole('button', { name: 'Chats' });
  await userEvent.click(button);
  await userEvent.keyboard('{Alt>}{ArrowDown}{ArrowUp}{/Alt}');
  expect(click).not.toHaveBeenCalled();
  expect(button).toHaveFocus();
  expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('textbox', { name: 'Search text' }));
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  expect(click).not.toHaveBeenCalled();
  modal.unmount();
});
