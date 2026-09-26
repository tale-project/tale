// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

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
    search: _search,
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
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useLocation: () => location.current,
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

const { HomeNavigator } = await import('./home-panel');

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
    inboxPagination: { canLoadMore: false, loadMore: vi.fn() },
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

  it('says so when a view is empty', async () => {
    homeData.current = data({ items: [] });
    const { user } = render(<HomeNavigator organizationId="org-1" />);
    await user.click(screen.getByRole('radio', { name: /Tasks/ }));
    expect(screen.getByText('Nothing assigned to you')).toBeInTheDocument();
  });

  it('hides the Inbox view when the organization has no inbox', () => {
    homeData.current = data({ hasInbox: false });
    render(<HomeNavigator organizationId="org-1" />);
    expect(
      screen.queryByRole('radio', { name: /Inbox/ }),
    ).not.toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = render(<HomeNavigator organizationId="org-1" />);
    await checkAccessibility(container);
  });
});
