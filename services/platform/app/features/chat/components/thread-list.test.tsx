// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { ChatProjectSummary, ChatThreadSummary } from '../types';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params: Record<string, string>;
    className?: string;
    'aria-current'?: 'page';
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

// The seam states these tests steer. Threads arrive via props; the project
// folders and the two writes (pin, drag-move) come through the chat backend
// seam, mocked here so no Convex client is needed.
const projectsResult = vi.hoisted(() => ({
  current: { status: 'ready', data: [] } as unknown,
}));
const setPinnedMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/chat-backend')>();
  return {
    ...original,
    useChatProjects: vi.fn(() => projectsResult.current),
    useProjectPin: vi.fn(() => ({
      available: true,
      setPinned: setPinnedMock,
    })),
    useThreadProjectMove: vi.fn(() => ({
      available: true,
      move: vi.fn(() => Promise.resolve(true)),
    })),
  };
});

import { ThreadList } from './thread-list';

const PROJECTS: ChatProjectSummary[] = [{ id: 'p1', name: 'Website revamp' }];

const THREADS: ChatThreadSummary[] = [
  {
    id: 't1',
    title: 'Quarterly report',
    kind: 'direct',
    archived: false,
    updatedAt: 2,
    generating: false,
  },
  {
    id: 't2',
    title: 'Refactor the importer',
    kind: 'sandbox',
    archived: false,
    updatedAt: 1,
    generating: true,
  },
  {
    id: 't3',
    title: 'Landing copy',
    kind: 'direct',
    projectId: 'p1',
    archived: false,
    updatedAt: 3,
    generating: false,
  },
];

function setProjects(data: ChatProjectSummary[]) {
  projectsResult.current = { status: 'ready', data };
}

afterEach(() => {
  navigateMock.mockReset();
  setPinnedMock.mockClear();
  setProjects([]);
  // The collapsed-folder choice persists in localStorage; a test must not
  // inherit the previous one's toggles.
  window.localStorage.clear();
});

describe('ThreadList', () => {
  it('files threads under their project folder and lists the rest under Chats', () => {
    setProjects(PROJECTS);
    render(
      <ThreadList
        organizationId="org-1"
        threads={THREADS}
        activeThreadId="t3"
      />,
    );

    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Chats')).toBeInTheDocument();

    // The folder carries its name and its thread count; the filed thread
    // renders inside it (expanded, because it holds the open thread).
    expect(
      screen.getByRole('button', { name: 'Website revamp' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Landing copy')).toBeInTheDocument();

    // The loose threads stay in the flat list.
    expect(screen.getByText('Quarterly report')).toBeInTheDocument();
    expect(screen.getByText('Refactor the importer')).toBeInTheDocument();
  });

  it('marks the sandbox thread and the one that is generating', () => {
    render(<ThreadList organizationId="org-1" threads={THREADS} />);

    expect(screen.getByLabelText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText('Generating response')).toBeInTheDocument();
  });

  it('marks the open thread as the current page', () => {
    render(
      <ThreadList
        organizationId="org-1"
        threads={THREADS}
        activeThreadId="t2"
      />,
    );

    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent(
      'Refactor the importer',
    );
  });

  it('names an untitled thread rather than showing a blank row', () => {
    render(
      <ThreadList
        organizationId="org-1"
        threads={[{ ...THREADS[0], title: undefined }]}
      />,
    );

    expect(screen.getByText('Untitled chat')).toBeInTheDocument();
  });

  it('offers a per-project new chat that lands in the project', async () => {
    setProjects(PROJECTS);
    const { user } = render(
      <ThreadList organizationId="org-1" threads={THREADS} />,
    );

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'New chat' }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/dashboard/$id/chat',
      params: { id: 'org-1' },
      search: { projectId: 'p1' },
    });
  });

  it('pins a project from its folder menu', async () => {
    setProjects(PROJECTS);
    const { user } = render(
      <ThreadList organizationId="org-1" threads={THREADS} />,
    );

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pin project' }));

    expect(setPinnedMock).toHaveBeenCalledWith('p1', true);
  });

  it('renders the chrome immediately and masks only the unanswered rows', () => {
    render(
      <ThreadList organizationId="org-1" threads={[]} available={false} />,
    );

    // Section headers and their affordances are known at mount — they render
    // real, not masked, so the panel is usable while the rows load.
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New project' }),
    ).toBeInTheDocument();

    // The unanswered rows hold masked stand-ins; no real row, no premature
    // empty state.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.queryByText('No conversations yet')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('shows the empty state once the backend answers with no threads', () => {
    render(<ThreadList organizationId="org-1" threads={[]} />);

    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    // The new-project affordance keeps its home on the PROJECTS header.
    expect(
      screen.getByRole('button', { name: 'New project' }),
    ).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    setProjects(PROJECTS);
    const { container } = render(
      <ThreadList organizationId="org-1" threads={THREADS} />,
    );
    await waitFor(() => checkAccessibility(container));
  });
});
