import '@testing-library/jest-dom/vitest';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type {
  ChatProjectSummary,
  ChatThreadSummary,
} from '@/app/features/chat/types';
import { projectConversationItem } from '@/lib/shared/conversations/conversation-item';
import { contrastRatio, deriveAccentPalette } from '@/lib/utils/color';
import { painted } from '@/tests/utils/paint';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import type { HomeData } from '../hooks/use-home-data';
import type { HomeItem } from '../lib/home-items';
import { HomeNavigator, HomePanel } from './home-panel';
import { HomePanelProvider } from './home-panel-context';
import { HomeConversationRow } from './home-rows';
import { WINDOWED_STREAM_MIN_ROWS } from './home-stream';

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
  backend.home = homeData(projects, threads, unread);
  backend.location = {
    pathname: `/dashboard/${ORG}/chat/${openThreadId}`,
    search: {},
  };
  return render(
    <div
      data-testid="frame"
      style={{ height, ...(width !== undefined ? { width } : {}) }}
      className={`bg-background flex w-70 flex-col overflow-hidden ${variant === 'screen' ? 'mobile-nav-shell' : ''}`}
    >
      <HomeNavigator organizationId={ORG} variant={variant} />
      {variant === 'screen' && (
        <nav aria-label="Primary navigation" className="mobile-tab-bar" />
      )}
    </div>,
  );
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
    expect(drawnInside(last, stream)).toBe(true);

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
});

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
