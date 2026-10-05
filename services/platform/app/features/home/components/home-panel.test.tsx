// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import type { HomeData } from '../hooks/use-home-data';
import { homeDraftKey } from '../lib/home-drafts';

const location = vi.hoisted(() => ({
  current: { pathname: '/dashboard/org-1/chat/t1', search: {} } as {
    pathname: string;
    search: Record<string, unknown>;
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    // Resolve the route's params into the href, so a test can tell rows
    // apart by where they lead.
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return (
      <a
        href={href}
        {...(search !== undefined
          ? { 'data-search': JSON.stringify(search) }
          : {})}
        {...rest}
      >
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useLocation: () => location.current,
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'u1' } }),
}));

// The three reads Home is made of, steered per test.
const homeData = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../hooks/use-home-data', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../hooks/use-home-data')>();
  return {
    ...original,
    useHomeData: () => homeData.current,
  };
});

const NO_HOLDS = vi.hoisted(() => ({
  status: 'ready' as const,
  data: { orgHeld: false, targetIds: [] as string[] },
}));

// Every row reads its age once per render: the calls say which rows rendered.
const ageReads = vi.hoisted(() => ({ current: [] as (number | undefined)[] }));
vi.mock('../hooks/use-compact-age', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../hooks/use-compact-age')>();
  return {
    ...original,
    useCompactAge: (
      timestamp: number | undefined,
      options?: { paused?: boolean },
    ) => {
      ageReads.current.push(timestamp);
      return original.useCompactAge(timestamp, options);
    },
  };
});

vi.mock('@/app/features/chat/data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/app/features/chat/data/chat-backend')
    >();
  return {
    ...original,
    // One object, as react-query hands back an unchanged answer.
    useThreadHolds: () => NO_HOLDS,
    useProjectPin: () => ({ available: true, setPinned: vi.fn() }),
    useThreadProjectMove: () => ({ available: true, move: vi.fn() }),
    useArchivedThreads: () => ({ status: 'ready', data: [] }),
  };
});

const { HomeNavigator, HomePanel } = await import('./home-panel');

const EDITOR = defineAbilityFor('editor');
const MEMBER = defineAbilityFor('member');
const { HomePanelProvider } = await import('./home-panel-context');

// Noon today — the rows below land in Today and Yesterday.
const NOW = new Date();
NOW.setHours(12, 0, 0, 0);
const TODAY = NOW.getTime() - 60 * 60 * 1000;
const YESTERDAY = NOW.getTime() - 26 * 60 * 60 * 1000;

function data(overrides: Partial<HomeData> = {}): HomeData {
  return {
    items: [
      {
        kind: 'chat',
        id: 't1',
        title: 'Quarterly report',
        activityAt: TODAY,
        unread: false,
        generating: false,
        shared: false,
        projectId: 'p1',
      },
      {
        kind: 'task',
        id: 'k1',
        title: 'Review the launch checklist',
        activityAt: TODAY - 1000,
        unread: true,
        identifier: 'WEB-2',
        status: 'in_review',
        awaitingMyReview: true,
      },
      {
        kind: 'conversation',
        id: 'c1',
        title: 'Invoice shows the wrong VAT rate',
        activityAt: YESTERDAY,
        unread: true,
        status: 'open',
        contactLabel: 'Anna Meier',
        preview: 'Can you correct it?',
      },
    ],
    threadsById: new Map([
      [
        't1',
        {
          id: 't1',
          title: 'Quarterly report',
          kind: 'direct',
          projectId: 'p1',
          archived: false,
          createdAt: TODAY,
          updatedAt: TODAY,
          generating: false,
        },
      ],
    ]),
    projects: [{ id: 'p1', name: 'Website relaunch', key: 'WEB' }],
    loading: {
      chats: false,
      tasks: false,
      conversations: false,
      projects: false,
    },
    failed: { chats: false, tasks: false, conversations: false },
    retrying: false,
    retry: vi.fn(),
    hasInbox: true,
    attention: { chats: 0, tasks: 1, inbox: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  homeData.current = data();
  location.current = { pathname: '/dashboard/org-1/chat/t1', search: {} };
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function stream() {
  return screen.getByRole('list', {
    name: 'Your chats, tasks and conversations',
  });
}

function largeData() {
  // A zero-height jsdom scrollport is hidden to the virtualizer. Give this
  // fixture a measured viewport and rows; Chromium owns the actual layout.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.matches('li[data-index]') ? 48 : 720;
    },
  );
  return data({
    items: Array.from({ length: 1000 }, (_, index) => ({
      kind: 'task' as const,
      id: `scale-${index}`,
      title: `Scale ${String(index).padStart(4, '0')}`,
      activityAt: TODAY - index * 1000,
      unread: false,
      status: 'todo' as const,
      awaitingMyReview: false,
    })),
    projects: Array.from({ length: 1000 }, (_, index) => ({
      id: `project-${index}`,
      name: `Project ${String(index).padStart(4, '0')}`,
      key: `P${index}`,
    })),
  });
}

describe('HomeNavigator', () => {
  it.each(['task', 'project'] as const)(
    'reveals a linked %s without mounting preceding rows',
    (kind) => {
      homeData.current = largeData();
      location.current = {
        pathname:
          kind === 'task'
            ? '/dashboard/org-1/tasks/scale-999'
            : '/dashboard/org-1/projects/project-999',
        search: {},
      };
      render(<HomeNavigator organizationId="org-1" />);
      const projects = screen.getByRole('region', { name: 'Projects' });
      if (kind === 'task') {
        expect(
          within(stream()).getAllByRole('link', { hidden: true }).length,
        ).toBeLessThan(70);
        expect(
          within(stream()).getByRole('link', { current: 'page' }),
        ).toHaveTextContent('Scale 0999');
      } else {
        expect(
          within(projects).getAllByRole('link', {
            name: /Project \d{4}/,
            hidden: true,
          }).length,
        ).toBeLessThan(70);
        expect(
          within(projects).getByRole('link', { current: 'page' }),
        ).toHaveTextContent('Project 0999');
      }
    },
  );

  it('bounds large streams and project trees, while searching the whole collection', async () => {
    homeData.current = largeData();
    render(<HomeNavigator organizationId="org-1" />);
    const projects = screen.getByRole('region', { name: 'Projects' });
    expect(
      within(stream()).getAllByRole('link', { hidden: true }).length,
    ).toBeLessThan(70);
    expect(
      within(projects).getAllByRole('link', {
        name: /Project \d{4}/,
        hidden: true,
      }).length,
    ).toBeLessThan(70);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Scale 0999' },
    });
    await waitFor(() =>
      expect(
        within(stream()).getAllByRole('link', { hidden: true }),
      ).toHaveLength(1),
    );
    expect(
      within(stream()).getByRole('link', { name: /Scale 0999/ }),
    ).toBeInTheDocument();
  });

  it('lists chats, tasks and conversations together, newest first, in day bands', () => {
    render(<HomeNavigator organizationId="org-1" />);

    const list = stream();
    expect(within(list).getByText('Today')).toBeInTheDocument();
    expect(within(list).getByText('Yesterday')).toBeInTheDocument();

    const links = within(list)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      '/dashboard/org-1/chat/t1',
      '/dashboard/org-1/tasks/k1',
      '/dashboard/org-1/conversations/open',
    ]);
  });

  it('gives each row its context line', () => {
    render(<HomeNavigator organizationId="org-1" />);
    const list = stream();
    // A chat names its project; a task its key and state; a conversation
    // who it is with and the latest message.
    expect(within(list).getByText('WEB-2')).toBeInTheDocument();
    expect(
      within(list).getByText('Waiting for your review'),
    ).toBeInTheDocument();
    expect(within(list).getByText('Anna Meier')).toBeInTheDocument();
    expect(within(list).getByText(/Can you correct it/)).toBeInTheDocument();
    expect(
      within(list).getAllByText('Website relaunch').length,
    ).toBeGreaterThan(0);
  });

  it('marks the open item as the current page', () => {
    render(<HomeNavigator organizationId="org-1" />);
    expect(
      within(stream()).getByRole('link', { current: 'page' }),
    ).toHaveAttribute('href', '/dashboard/org-1/chat/t1');
  });

  // A long list re-rendered every row on every navigation — 600 chats and
  // 250 projects, three times over on one chat switch.
  it('re-renders only the rows a navigation closes and opens', () => {
    const view = render(<HomeNavigator organizationId="org-1" />);
    ageReads.current = [];

    location.current = { pathname: '/dashboard/org-1/tasks/k1', search: {} };
    view.rerender(<HomeNavigator organizationId="org-1" />);

    expect(
      within(stream()).getByRole('link', { current: 'page' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/k1');
    // The chat that closed and the task that opened; not the conversation.
    expect(new Set(ageReads.current)).toEqual(new Set([TODAY, TODAY - 1000]));
  });

  it('narrows the stream to one kind from the switcher, and remembers it', async () => {
    const { user, unmount } = render(<HomeNavigator organizationId="org-1" />);

    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(
      within(stream())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/dashboard/org-1/tasks/k1']);

    unmount();
    render(<HomeNavigator organizationId="org-1" />);
    expect(screen.getByRole('radio', { name: /Tasks/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('lists the projects as doors to their pages', () => {
    render(<HomeNavigator organizationId="org-1" />);
    const projects = screen.getByRole('region', { name: 'Projects' });
    expect(
      within(projects).getByRole('link', { name: /Website relaunch/ }),
    ).toHaveAttribute('href', '/dashboard/org-1/projects/p1');
  });

  it('offers New project only to a role that may create one', () => {
    // The server refuses a project create below the Editor role.
    const { unmount } = render(
      <AbilityContext.Provider value={EDITOR}>
        <HomeNavigator organizationId="org-1" />
      </AbilityContext.Provider>,
    );
    expect(
      screen.getByRole('button', { name: 'New project' }),
    ).toBeInTheDocument();
    unmount();

    render(
      <AbilityContext.Provider value={MEMBER}>
        <HomeNavigator organizationId="org-1" />
      </AbilityContext.Provider>,
    );
    expect(
      screen.getByRole('region', { name: 'Projects' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New project' }),
    ).not.toBeInTheDocument();
  });

  it('shows a draft row while a fresh chat is being written', () => {
    location.current = { pathname: '/dashboard/org-1/chat', search: {} };
    render(<HomeNavigator organizationId="org-1" />);
    expect(
      within(stream()).getByRole('link', { current: 'page' }),
    ).toHaveTextContent('New chat');
  });

  it('says so when a view is empty, and offers the way forward', async () => {
    homeData.current = data({ items: [] });
    location.current = { pathname: '/dashboard/org-1/projects', search: {} };
    const { user } = render(<HomeNavigator organizationId="org-1" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New chat' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/chat',
    );

    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(screen.getByText('Nothing assigned to you')).toBeInTheDocument();
    // Tasks are handed out in projects.
    expect(
      screen
        .getAllByRole('link', { name: 'All projects' })
        .some(
          (link) => link.getAttribute('href') === '/dashboard/org-1/projects',
        ),
    ).toBe(true);
  });

  it('hides the Inbox view when the organization has no inbox', () => {
    homeData.current = data({ hasInbox: false });
    render(<HomeNavigator organizationId="org-1" />);
    expect(
      screen.queryByRole('radio', { name: /Inbox/ }),
    ).not.toBeInTheDocument();
  });

  it('opens the next and previous item with ⌥↓ and ⌥↑', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<HomeNavigator organizationId="org-1" />);

    // The chat is open; the task sits under it.
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(click.mock.contexts.at(-1)).toHaveAttribute(
      'href',
      '/dashboard/org-1/tasks/k1',
    );
    click.mockRestore();
  });

  it('moves between rows with the arrow keys', () => {
    render(<HomeNavigator organizationId="org-1" />);
    const [first, second] = within(stream()).getAllByRole('link');
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second as HTMLElement, { key: 'ArrowUp' });
    expect(first).toHaveFocus();
  });

  it.each(
    (
      [
        ['chat', 't1', 'Quarterly report'],
        ['task', 'k1', 'Review the launch checklist'],
      ] as const
    ).flatMap(([kind, id, title]) =>
      ['<Button />', '<tag>', 'ordinary unsent note', '', '   '].map(
        (text) => [kind, id, title, text] as const,
      ),
    ),
  )(
    'keeps literal %s drafts discoverable after leaving, reopening and remounting (%s, %s, %j)',
    (kind, id, title, text) => {
      const pathname =
        '/dashboard/org-1/' + (kind === 'chat' ? 'chat' : 'tasks') + '/' + id;
      const key = homeDraftKey({ kind, id }, 'u1', 'org-1');
      const stored = JSON.stringify(text);
      window.localStorage.setItem(key, stored);
      location.current = { pathname, search: {} };
      const view = render(<HomeNavigator organizationId="org-1" />);
      const row = () =>
        within(stream()).getByRole('link', { name: new RegExp(title) });
      expect(row()).not.toHaveTextContent('Draft');

      location.current = { pathname: '/dashboard/org-1/chat', search: {} };
      view.rerender(<HomeNavigator organizationId="org-1" />);
      expect(row().textContent?.includes('Draft')).toBe(text.trim().length > 0);

      location.current = { pathname, search: {} };
      view.rerender(<HomeNavigator organizationId="org-1" />);
      expect(row()).not.toHaveTextContent('Draft');
      expect(window.localStorage.getItem(key)).toBe(stored);
      view.unmount();

      location.current = { pathname: '/dashboard/org-1/chat', search: {} };
      const reloaded = render(<HomeNavigator organizationId="org-1" />);
      expect(row().textContent?.includes('Draft')).toBe(text.trim().length > 0);
      expect(window.localStorage.getItem(key)).toBe(stored);
      reloaded.unmount();
    },
  );

  it('marks an item whose composer holds something unsent', () => {
    window.localStorage.setItem(
      'task-comment-draft-u1-org-1-k1',
      JSON.stringify('Half a thought'),
    );
    render(<HomeNavigator organizationId="org-1" />);
    const task = within(stream()).getByRole('link', {
      name: /Review the launch checklist/,
    });
    expect(task).toHaveTextContent('Draft');
    // The open chat's composer is in view — its row says nothing.
    expect(
      within(stream()).getByRole('link', { current: 'page' }),
    ).not.toHaveTextContent('Draft');
  });

  it('updates task rows when the priority facet changes without new source data', async () => {
    const base = data();
    homeData.current = data({
      items: base.items.map((item) =>
        item.kind === 'task'
          ? Object.assign({}, item, { priority: 'p0' as const })
          : item,
      ),
    });
    const { user } = render(<HomeNavigator organizationId="org-1" />);
    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('button', { name: /Priority/ }));
    await user.click(screen.getByRole('checkbox', { name: 'High' }));
    expect(
      screen.queryByRole('link', { name: /Review the launch checklist/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Urgent' }));
    expect(
      screen.getByRole('link', { name: /Review the launch checklist/ }),
    ).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = render(<HomeNavigator organizationId="org-1" />);
    await checkAccessibility(container);
  });
});

/**
 * A read that gave up is unknown, never "none" (#4093): the views that list
 * its kind say it did not load, with Try again, above the rows that did —
 * and never offer the empty view's way forward for a list nobody read.
 */
describe('HomeNavigator when a read fails', () => {
  function failed(sources: Partial<HomeData['failed']>): HomeData['failed'] {
    return { chats: false, tasks: false, conversations: false, ...sources };
  }

  const hrefs = () =>
    within(stream())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

  it('keeps the rows that loaded and names the kind that did not, with Try again', async () => {
    const retry = vi.fn();
    homeData.current = data({
      items: data().items.filter((item) => item.kind !== 'chat'),
      failed: failed({ chats: true }),
      attention: { chats: null, tasks: 1, inbox: 1 },
      retry,
    });
    const { user } = render(<HomeNavigator organizationId="org-1" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your chats.");
    expect(hrefs()).toEqual([
      '/dashboard/org-1/tasks/k1',
      '/dashboard/org-1/conversations/open',
    ]);
    // An unknown count is no count: the Chats option claims nothing.
    expect(
      screen.getByRole('radio', { name: 'Chats' }),
    ).not.toHaveAccessibleName(/needs you/);

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);

    // The Tasks view lists no chats, so it has nothing to say about them.
    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(hrefs()).toEqual(['/dashboard/org-1/tasks/k1']);
  });

  it('says the reads failed instead of that the view is empty, and offers no way forward from an empty list', async () => {
    homeData.current = data({
      items: [],
      threadsById: new Map(),
      failed: failed({ chats: true, tasks: true, conversations: true }),
      attention: { chats: null, tasks: null, inbox: null },
    });
    location.current = { pathname: '/dashboard/org-1/projects', search: {} };
    const { user } = render(<HomeNavigator organizationId="org-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load your chats. Couldn't load your tasks. Couldn't load the customer conversations.",
    );
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'New chat' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Couldn't load your chats\.\s*Try again$/,
    );
    expect(screen.queryByText('No chats yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Couldn't load your tasks\.\s*Try again$/,
    );
    expect(
      screen.queryByText('Nothing assigned to you'),
    ).not.toBeInTheDocument();
    // The only way to every project left is the Projects section's own.
    const projects = screen.getByRole('region', { name: 'Projects' });
    expect(screen.getAllByRole('link', { name: 'All projects' })).toHaveLength(
      within(projects).getAllByRole('link', { name: 'All projects' }).length,
    );
  });

  it('says it is trying again while the retry runs, and keeps Try again in place', async () => {
    const retry = vi.fn();
    homeData.current = data({
      items: [],
      threadsById: new Map(),
      failed: failed({ chats: true, tasks: true, conversations: true }),
      retrying: true,
      retry,
    });
    const { user } = render(<HomeNavigator organizationId="org-1" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Trying again…');
    const button = within(alert).getByRole('button', { name: 'Try again' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(retry).not.toHaveBeenCalled();
  });

  it('hands the focus to the search box when a retry that worked takes Try again away', async () => {
    homeData.current = data({
      items: data().items.filter((item) => item.kind !== 'chat'),
      failed: failed({ chats: true }),
    });
    const { rerender } = render(<HomeNavigator organizationId="org-1" />);
    within(screen.getByRole('alert'))
      .getByRole('button', { name: 'Try again' })
      .focus();

    homeData.current = data();
    rerender(<HomeNavigator organizationId="org-1" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search all...')).toHaveFocus(),
    );
  });

  it('says so on the phone screen too, where Chats keeps its own New chat', async () => {
    homeData.current = data({
      items: data().items.filter((item) => item.kind !== 'chat'),
      failed: failed({ chats: true }),
      attention: { chats: null, tasks: 1, inbox: 1 },
    });
    location.current = { pathname: '/dashboard/org-1/home', search: {} };
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );

    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load your chats.",
    );
    expect(screen.queryByText('No chats yet')).not.toBeInTheDocument();
    // The view's own way to a new chat stays: it claims nothing about the
    // list, unlike an empty state's offer.
    expect(screen.getByRole('link', { name: 'New chat' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/chat',
    );
  });

  it('passes an axe audit, with a read failed beside rows and with nothing loaded', async () => {
    homeData.current = data({
      items: data().items.filter((item) => item.kind !== 'task'),
      failed: failed({ tasks: true }),
      attention: { chats: 0, tasks: null, inbox: 1 },
    });
    const { container, unmount } = render(
      <HomeNavigator organizationId="org-1" />,
    );
    await checkAccessibility(container);
    unmount();

    homeData.current = data({
      items: [],
      threadsById: new Map(),
      failed: failed({ chats: true, tasks: true, conversations: true }),
      attention: { chats: null, tasks: null, inbox: null },
    });
    const again = render(<HomeNavigator organizationId="org-1" />);
    await checkAccessibility(again.container);
  });
});

describe('HomeNavigator on the phone screen', () => {
  const hrefs = () =>
    within(stream())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

  beforeEach(() => {
    location.current = { pathname: '/dashboard/org-1/home', search: {} };
    const base = data();
    homeData.current = data({
      items: [
        ...base.items,
        {
          kind: 'task',
          id: 'k2',
          title: 'Draft the press release',
          activityAt: TODAY - 2000,
          unread: false,
          identifier: 'WEB-3',
          status: 'todo',
          awaitingMyReview: false,
          projectId: 'p1',
        },
        {
          kind: 'chat',
          id: 't2',
          title: 'Unfiled chat',
          activityAt: TODAY - 3000,
          unread: false,
          generating: false,
          shared: false,
        },
      ],
      threadsById: new Map([
        ...base.threadsById,
        [
          't2',
          {
            id: 't2',
            title: 'Unfiled chat',
            kind: 'direct',
            archived: false,
            createdAt: TODAY,
            updatedAt: TODAY,
            generating: false,
          },
        ],
      ]),
    });
  });

  function projectRow() {
    return within(screen.getByRole('region', { name: 'Projects' })).getByRole(
      'button',
      // Not the row's "Actions for Website relaunch" menu, which the plain
      // name would also match.
      { name: /^(?!Actions for).*Website relaunch/ },
    );
  }

  it('turns a project row into a toggle on project views (Chats/Tasks) instead of a link', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    const projects = screen.getByRole('region', { name: 'Projects' });
    expect(
      within(projects).queryByRole('link', { name: /Website relaunch/ }),
    ).not.toBeInTheDocument();
    expect(projectRow()).toHaveAttribute('aria-pressed', 'false');

    await user.click(projectRow());
    expect(projectRow()).toHaveAttribute('aria-pressed', 'true');
    // Only the project's chat stays.
    expect(hrefs()).toEqual(['/dashboard/org-1/chat/t1']);

    await user.click(projectRow());
    expect(projectRow()).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers Open project and Pin project in a project menu without showing redundant scope bars', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();

    await user.click(projectRow());
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();

    const projects = screen.getByRole('region', { name: 'Projects' });
    await user.click(
      within(projects).getByRole('button', {
        name: 'Actions for Website relaunch',
      }),
    );
    // No New chat: on a phone it leads the Chats view instead.
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open project', 'Pin project']);
  });

  it('narrows the Tasks view to the project too', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(hrefs()).toEqual([
      '/dashboard/org-1/tasks/k1',
      '/dashboard/org-1/tasks/k2',
    ]);
    await user.click(projectRow());
    expect(hrefs()).toEqual(['/dashboard/org-1/tasks/k2']);
  });

  it('remembers the narrowing, and drops it once the project is gone', async () => {
    const { user, unmount } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    await user.click(projectRow());
    unmount();

    const again = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await again.user.click(screen.getByRole('radio', { name: /Chats/ }));
    expect(projectRow()).toHaveAttribute('aria-pressed', 'true');
    expect(hrefs()).toEqual(['/dashboard/org-1/chat/t1']);
    again.unmount();

    homeData.current = data({ projects: [] });
    render(<HomeNavigator organizationId="org-1" variant="screen" />);
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
  });

  it('says which view of the project is empty instead of "nothing yet"', async () => {
    homeData.current = data({
      items: data().items.filter((item) => item.kind === 'conversation'),
    });
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    await user.click(projectRow());
    expect(screen.getByText('No chats in this project')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(projectRow()).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText('No open tasks assigned to you in this project'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing assigned to you'),
    ).not.toBeInTheDocument();
  });

  it('holds back the archived chats while narrowed', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    expect(screen.getByRole('button', { name: /Archived/ })).toBeVisible();
    await user.click(projectRow());
    expect(
      screen.queryByRole('button', { name: /Archived/ }),
    ).not.toBeInTheDocument();
  });

  it('starts a chat only from the Chats view, under the narrowed project', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    const newChat = () => screen.queryByRole('link', { name: 'New chat' });
    expect(newChat()).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(newChat()).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    expect(newChat()).toHaveAttribute('href', '/dashboard/org-1/chat');
    expect(newChat()).toHaveAttribute('data-search', '{"new":true}');

    await user.click(projectRow());
    expect(newChat()).toHaveAttribute('data-search', '{"projectId":"p1"}');
  });

  it('creates nothing else, and labels the way to every project', async () => {
    homeData.current = data({ items: [] });
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    expect(
      screen.queryByRole('button', { name: 'New project' }),
    ).not.toBeInTheDocument();
    // The empty All view offers no first chat: that lives in Chats.
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'New chat' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    const projects = screen.getByRole('region', { name: 'Projects' });
    const all = within(projects).getByRole('link', { name: 'All projects' });
    expect(all).toHaveAttribute('href', '/dashboard/org-1/projects');
    expect(all).toHaveTextContent('All projects');
  });

  it('passes an axe audit, narrowed', async () => {
    const { user, container } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(screen.getByRole('radio', { name: /Chats/ }));
    await user.click(projectRow());
    await checkAccessibility(container);
  });
});

describe('HomePanel', () => {
  it('opens on the view switcher, with New chat beside it and no header', () => {
    render(
      <HomePanelProvider organizationId="org-1">
        <HomePanel organizationId="org-1" />
      </HomePanelProvider>,
    );
    const panel = screen.getByRole('navigation', { name: 'Home' });
    // The rail already names the section; the panel carries no heading.
    expect(within(panel).queryByRole('heading', { level: 2 })).toBeNull();
    const switcher = within(panel).getByRole('radiogroup');
    const newChat = within(panel).getAllByRole('link', { name: 'New chat' })[0];
    expect(newChat).toHaveAttribute('href', '/dashboard/org-1/chat');
    // Beside the switcher: the two share one row.
    // oxlint-disable-next-line testing-library/no-node-access -- the row is structural, not a queryable role
    expect(switcher.parentElement?.parentElement).toContainElement(newChat);
  });

  function backslash() {
    // Whichever of the two the platform uses as its command key.
    fireEvent.keyDown(window, {
      key: '\\',
      code: 'Backslash',
      metaKey: true,
      ctrlKey: true,
    });
  }

  it('folds and unfolds with ⌘\\ on a page whose header can bring it back', () => {
    render(
      <HomePanelProvider organizationId="org-1">
        <HomePanel organizationId="org-1" />
      </HomePanelProvider>,
    );
    backslash();
    expect(window.localStorage.getItem('chat-history-panel-open-org-1')).toBe(
      'false',
    );
    backslash();
    expect(window.localStorage.getItem('chat-history-panel-open-org-1')).toBe(
      'true',
    );
  });

  it("folds with ⌘\\ on a project's page, whose header carries the toggle", () => {
    location.current = { pathname: '/dashboard/org-1/projects/p1', search: {} };
    render(
      <HomePanelProvider organizationId="org-1">
        <HomePanel organizationId="org-1" />
      </HomePanelProvider>,
    );
    backslash();
    expect(window.localStorage.getItem('chat-history-panel-open-org-1')).toBe(
      'false',
    );
  });

  it('ignores ⌘\\ where the panel stays open', () => {
    // The projects list has no toggle to bring the panel back.
    location.current = { pathname: '/dashboard/org-1/projects', search: {} };
    render(
      <HomePanelProvider organizationId="org-1">
        <HomePanel organizationId="org-1" />
      </HomePanelProvider>,
    );
    backslash();
    expect(
      window.localStorage.getItem('chat-history-panel-open-org-1'),
    ).toBeNull();
  });
});
