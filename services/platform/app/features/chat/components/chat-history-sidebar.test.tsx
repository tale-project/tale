import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { ChatHistorySidebar } from './chat-history-sidebar';

// Controllable hook results (hoisted so the vi.mock factories can close over
// them). Each test drives what the threads / projects queries return to
// exercise the skeleton gate across loading permutations.
const { threadsRef, projectsRef } = vi.hoisted(() => {
  interface ThreadsState {
    threads:
      | Array<{ _id: string; title: string; _creationTime: number }>
      | undefined;
    isLoading: boolean;
    isLoadingFirstPage: boolean;
    canLoadMore: boolean;
    isLoadingMore: boolean;
    loadMore: () => void;
  }
  interface ProjectsState {
    projects: Array<{
      _id: string;
      name: string;
      icon?: string;
      color?: string;
      pinnedAt?: number;
    }>;
    isLoading: boolean;
  }
  return {
    threadsRef: { current: undefined as unknown as ThreadsState },
    projectsRef: { current: undefined as unknown as ProjectsState },
  };
});

const loadedThreads = () => ({
  threads: [{ _id: 'thread-1', title: 'Budget kickoff', _creationTime: 1 }],
  isLoading: false,
  isLoadingFirstPage: false,
  canLoadMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
});

const loadingThreads = () => ({
  threads: undefined,
  isLoading: true,
  isLoadingFirstPage: true,
  canLoadMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
});

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useRouter: () => ({ preloadRoute: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useThreads: () => threadsRef.current,
  useArchivedThreads: () => ({
    threads: [],
    isLoading: false,
    canLoadMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  }),
  useActiveApprovals: () => ({ approvals: [], isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateThread: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => projectsRef.current,
  useProjectThreads: () => ({ threads: [], isLoading: false }),
}));

vi.mock('@/app/features/projects/hooks/mutations', () => ({
  useSetProjectPinned: () => ({ mutate: vi.fn() }),
  // Consumed by the drag-and-drop provider wrapping the loaded list.
  useMoveThreadToProject: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useActiveHoldTargetIds: () => ({ data: undefined, isLoading: true }),
}));

// Heavy children that reach Convex on their own — irrelevant to the
// skeleton gate under test.
vi.mock('@/app/features/projects/components/project-create-dialog', () => ({
  ProjectCreateDialog: () => null,
}));

vi.mock('./chat-actions', () => ({
  ChatActions: () => null,
}));

describe('ChatHistorySidebar skeleton gate', () => {
  beforeEach(() => {
    threadsRef.current = loadedThreads();
    projectsRef.current = { projects: [], isLoading: false };
    window.localStorage.clear();
  });

  it('shows the skeleton while the threads first page loads', () => {
    threadsRef.current = loadingThreads();
    projectsRef.current = { projects: [], isLoading: true };

    render(<ChatHistorySidebar organizationId="org-1" />);

    // `busy: true` pins the query to the Skeletonize wrapper (dnd-kit mounts
    // its own bare `role="status"` live region in the loaded state).
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    expect(
      screen.queryByText(enMessages.chat.projectsSection),
    ).not.toBeInTheDocument();
  });

  // Regression for #2544: threads can resolve before projects; dismissing the
  // skeleton on threads alone lets project folder rows pop in after the first
  // real paint (layout shift).
  it('keeps the skeleton until projects have loaded too', () => {
    threadsRef.current = loadedThreads();
    projectsRef.current = { projects: [], isLoading: true };

    render(<ChatHistorySidebar organizationId="org-1" />);

    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    expect(
      screen.queryByText(enMessages.chat.projectsSection),
    ).not.toBeInTheDocument();
  });

  it('swaps to real content once both threads and projects resolve', () => {
    threadsRef.current = loadedThreads();
    projectsRef.current = {
      projects: [{ _id: 'project-1', name: 'Apollo' }],
      isLoading: false,
    };

    render(<ChatHistorySidebar organizationId="org-1" />);

    expect(
      screen.queryByRole('status', { busy: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(enMessages.chat.projectsSection),
    ).toBeInTheDocument();
    expect(screen.getByText('Apollo')).toBeInTheDocument();
    expect(screen.getByText('Budget kickoff')).toBeInTheDocument();
  });
});
