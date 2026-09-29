// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, within } from '@/tests/utils/render';

import type { HomeData } from '../hooks/use-home-data';

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

vi.mock('@/app/features/chat/data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/app/features/chat/data/chat-backend')
    >();
  return {
    ...original,
    useThreadHolds: () => ({
      status: 'ready',
      data: { orgHeld: false, targetIds: [] },
    }),
    useProjectPin: () => ({ available: true, setPinned: vi.fn() }),
    useThreadProjectMove: () => ({ available: true, move: vi.fn() }),
    useArchivedThreads: () => ({ status: 'ready', data: [] }),
  };
});

const { HomeNavigator, HomePanel } = await import('./home-panel');
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
});

function stream() {
  return screen.getByRole('list', {
    name: 'Your chats, tasks and conversations',
  });
}

describe('HomeNavigator', () => {
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

  it('passes an axe audit', async () => {
    const { container } = render(<HomeNavigator organizationId="org-1" />);
    await checkAccessibility(container);
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

  it('turns a project row into a toggle instead of a link out of Home', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    const projects = screen.getByRole('region', { name: 'Projects' });
    expect(
      within(projects).queryByRole('link', { name: /Website relaunch/ }),
    ).not.toBeInTheDocument();
    expect(projectRow()).toHaveAttribute('aria-pressed', 'false');
    expect(hrefs()).toHaveLength(5);

    await user.click(projectRow());
    expect(projectRow()).toHaveAttribute('aria-pressed', 'true');
    // The project's chat and task stay; the unfiled chat, the task of no
    // project and the conversation go.
    expect(hrefs()).toEqual([
      '/dashboard/org-1/chat/t1',
      '/dashboard/org-1/tasks/k2',
    ]);

    await user.click(projectRow());
    expect(projectRow()).toHaveAttribute('aria-pressed', 'false');
    expect(hrefs()).toHaveLength(5);
  });

  it('names the narrowing, and leads to the project page or back to everything', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();

    await user.click(projectRow());
    expect(screen.getByText(/^Showing /)).toHaveTextContent(
      'Showing Website relaunch only',
    );
    expect(screen.getByRole('link', { name: 'Open project' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/p1',
    );

    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
    expect(hrefs()).toHaveLength(5);
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
    await user.click(projectRow());
    unmount();

    const again = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    expect(screen.getByText(/^Showing /)).toBeInTheDocument();
    expect(hrefs()).toHaveLength(2);
    again.unmount();

    homeData.current = data({ projects: [] });
    render(<HomeNavigator organizationId="org-1" variant="screen" />);
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
    expect(hrefs()).toHaveLength(3);
  });

  it('says the project is empty instead of "nothing yet"', async () => {
    homeData.current = data({
      items: data().items.filter((item) => item.kind === 'conversation'),
    });
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
    await user.click(projectRow());
    expect(screen.getByText('Nothing in this project yet')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  });

  it('holds back the archived chats while narrowed', async () => {
    const { user } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
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

    const projects = screen.getByRole('region', { name: 'Projects' });
    const all = within(projects).getByRole('link', { name: 'All projects' });
    expect(all).toHaveAttribute('href', '/dashboard/org-1/projects');
    expect(all).toHaveTextContent('All projects');

    await user.click(
      within(projects).getByRole('button', {
        name: 'Actions for Website relaunch',
      }),
    );
    expect(
      screen.queryByRole('menuitem', { name: 'New chat' }),
    ).not.toBeInTheDocument();
  });

  it('passes an axe audit, narrowed', async () => {
    const { user, container } = render(
      <HomeNavigator organizationId="org-1" variant="screen" />,
    );
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

  it('ignores ⌘\\ where the panel stays open', () => {
    location.current = { pathname: '/dashboard/org-1/projects/p1', search: {} };
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
