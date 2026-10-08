import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import {
  ActorDirectoryProvider,
  useProvidedActorDirectory,
} from '../hooks/use-actor-directory';
import { TaskConversation } from './task-conversation';

// A task's discussion names every author, and every text run of every
// markdown body resolves its @mentions, against the actor directory. Each
// directory is five reads and a member index; one per row (and per text run)
// cost seconds to open and to close a task with hundreds of comments. These
// pin the list to ONE directory, whether the surface provides it or not.

const reads = vi.hoisted(() => ({ members: 0, editors: 0 }));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (namespace: string) => ({ t: i18n.getFixedT('en', namespace) }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => {
    reads.members += 1;
    return {
      members: [
        {
          userId: 'user-ada',
          displayName: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'member',
        },
      ],
    };
  },
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectAgents: () => ({ agents: [], isLoading: false }),
  useStandardAgent: () => undefined,
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-ada' } }),
}));

vi.mock('@/app/features/automations/hooks/use-can-use-automations', () => ({
  useCanUseAutomations: () => false,
}));

vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskContractAutomations: () => [],
}));

vi.mock('../hooks/mutations', () => ({
  useEditTaskComment: () => {
    reads.editors += 1;
    return { mutateAsync: vi.fn(), isPending: false };
  },
  useDeleteTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Jan 1, 2026',
    formatDateHeader: () => 'Today',
  }),
}));

// The shared chat renderer pulls chat chrome (images, citations); the plain
// element map keeps this about the directory, not the markdown.
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {},
}));

const COMMENTS = Array.from({ length: 40 }, (_, index) => ({
  messageId: `message-${index}`,
  authorType: 'user' as const,
  authorId: 'user-ada',
  body: [
    `Update ${index} for @ada about the rollout.`,
    '',
    '- first point',
    '- second point, @ada again',
    '',
    `Closing note ${index}.`,
  ].join('\n'),
  // Ten minutes apart: each comment opens with its author, none continues
  // the one before.
  createdAt: 1_700_000_000_000 + index * 600_000,
}));

vi.mock('../hooks/queries', () => ({
  useTaskDiscussion: () => ({
    comments: COMMENTS,
    isLoading: false,
    hasEarlier: false,
    isLoadingEarlier: false,
    loadEarlier: () => undefined,
  }),
  useTaskActivity: () => ({ activity: [] }),
  useTaskAgentRuns: () => ({ runs: [] }),
}));

function renderComments(wrap?: (children: ReactNode) => ReactNode) {
  const list = (
    <TaskConversation
      taskId="task-1"
      organizationId="org-1"
      projectId="project-1"
      canComment={false}
    />
  );
  return render(<>{wrap ? wrap(list) : list}</>);
}

describe('TaskConversation — one actor directory per discussion', () => {
  beforeEach(() => {
    reads.members = 0;
    reads.editors = 0;
  });

  it('names every author and mention from the directory the surface provides', () => {
    renderComments((children) => (
      <ActorDirectoryProvider organizationId="org-1" projectId="project-1">
        {children}
      </ActorDirectoryProvider>
    ));

    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(COMMENTS.length);
    // Two @ada mentions per comment, in a paragraph and in a list item.
    expect(screen.getAllByText('@Ada Lovelace')).toHaveLength(
      COMMENTS.length * 2,
    );
    // The provider's directory, read in its own renders — not once per
    // comment and per text run (that was 200+ reads here).
    expect(reads.members).toBeLessThanOrEqual(3);
    expect(reads.editors).toBe(0);
  });

  it('reads one directory for the whole list where nothing provides one', () => {
    renderComments();

    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(COMMENTS.length);
    expect(screen.getAllByText('@Ada Lovelace')).toHaveLength(
      COMMENTS.length * 2,
    );
    expect(reads.members).toBeLessThanOrEqual(3);
    expect(reads.editors).toBe(0);
  });
});

describe('useProvidedActorDirectory', () => {
  const provider =
    (projectId?: string) =>
    ({ children }: { children: ReactNode }) => (
      <ActorDirectoryProvider organizationId="org-1" projectId={projectId}>
        {children}
      </ActorDirectoryProvider>
    );

  it('answers the provided directory for the same organization and project', () => {
    const { result } = renderHook(
      () => useProvidedActorDirectory('org-1', 'project-1'),
      { wrapper: provider('project-1') },
    );
    expect(result.current?.resolveActor('user', 'user-ada').name).toBe(
      'Ada Lovelace',
    );
  });

  it('answers nothing for another project, or with no provider at all', () => {
    const otherProject = renderHook(
      () => useProvidedActorDirectory('org-1', 'project-2'),
      { wrapper: provider('project-1') },
    );
    expect(otherProject.result.current).toBeUndefined();

    const allProjects = renderHook(
      () => useProvidedActorDirectory('org-1', 'project-1'),
      { wrapper: provider(undefined) },
    );
    expect(allProjects.result.current).toBeUndefined();

    const none = renderHook(() =>
      useProvidedActorDirectory('org-1', 'project-1'),
    );
    expect(none.result.current).toBeUndefined();
  });
});
