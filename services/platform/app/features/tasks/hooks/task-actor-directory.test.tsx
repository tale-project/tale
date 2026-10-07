import { fireEvent, render, screen } from '@testing-library/react';
import { memo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActorDirectoryBoundary,
  useSharedActorDirectory,
  useSharedAssignableActors,
} from './task-actor-directory';
import {
  ActorDirectoryProvider,
  useProvidedActorDirectory,
} from './use-actor-directory';

const data = vi.hoisted(() => ({
  members: [
    {
      userId: 'user-1',
      displayName: 'Ada',
      email: 'ada@example.com',
      role: 'member',
    },
  ],
  agents: [{ _id: 'agent-1', name: 'Project agent' }],
  automations: [],
  scope: { orgWide: true, userIds: [] },
  project: { canEdit: true },
  memberRead: vi.fn(),
  agentRead: vi.fn(),
  backendRead: vi.fn(),
  standardRead: vi.fn(),
  childRender: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: (organizationId: string) => {
    data.memberRead(organizationId);
    return { members: data.members };
  },
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectAgents: (projectId?: string) => {
    data.agentRead(projectId);
    return {
      agents: projectId === undefined ? [] : data.agents,
      isLoading: false,
    };
  },
  useStandardAgent: (organizationId?: string) => {
    data.standardRead(organizationId);
    return { available: true };
  },
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-1' } }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    data.backendRead(name, args);
    return {
      data: name === 'projects/queries:getProject' ? data.project : data.scope,
    };
  },
}));
vi.mock('./use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-task-subject-contract')>()),
  useTaskContractAutomations: () => data.automations,
}));
vi.mock('@tale/ui/i18n/client', () => ({ useT: () => ({ t: data.t }) }));
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

const Reader = memo(function Reader({
  organizationId,
  projectId,
  candidates = false,
}: {
  organizationId: string;
  projectId?: string;
  candidates?: boolean;
}) {
  const directory = useSharedActorDirectory(organizationId, projectId);
  data.childRender();
  return (
    <span>
      {directory.resolveActor('user', 'user-1').name}
      {candidates ? (
        <Candidates organizationId={organizationId} projectId={projectId} />
      ) : null}
    </span>
  );
});

function Candidates({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  const directory = useSharedAssignableActors(organizationId, projectId);
  return <span>{directory.assignableMembers.length} candidates</span>;
}

beforeEach(() => {
  data.scope.orgWide = true;
  data.memberRead.mockClear();
  data.agentRead.mockClear();
  data.backendRead.mockClear();
  data.standardRead.mockClear();
  data.childRender.mockClear();
});

describe('task actor directory boundaries', () => {
  it('reuses a legacy automatic provider for matching shared display consumers', () => {
    render(
      <ActorDirectoryProvider organizationId="org-1" projectId="project-1">
        {Array.from({ length: 200 }, (_, index) => (
          <ActorDirectoryBoundary
            key={index}
            organizationId="org-1"
            projectId="project-1"
          >
            <Reader organizationId="org-1" projectId="project-1" />
          </ActorDirectoryBoundary>
        ))}
      </ActorDirectoryProvider>,
    );
    expect(screen.getAllByText('Ada')).toHaveLength(200);
    expect(data.memberRead).toHaveBeenCalledTimes(1);
    expect(data.agentRead).toHaveBeenCalledTimes(1);
    expect(data.backendRead).not.toHaveBeenCalled();
    expect(data.standardRead).not.toHaveBeenCalled();
  });

  it('shares the same assignment scope with the legacy provider and optional reader', () => {
    function LegacyReader() {
      const provided = useProvidedActorDirectory('org-1', 'project-1');
      const shared = useSharedActorDirectory('org-1', 'project-1');
      return (
        <span>
          {provided === shared ? 'Same directory' : 'Different directory'}
        </span>
      );
    }
    render(
      <ActorDirectoryBoundary
        organizationId="org-1"
        projectId="project-1"
        assignable
      >
        <ActorDirectoryProvider organizationId="org-1" projectId="project-1">
          <Reader organizationId="org-1" projectId="project-1" candidates />
          <LegacyReader />
        </ActorDirectoryProvider>
      </ActorDirectoryBoundary>,
    );
    expect(screen.getByText('Same directory')).toBeInTheDocument();
    expect(screen.getByText('1 candidates')).toBeInTheDocument();
    expect(data.memberRead).toHaveBeenCalledTimes(1);
    expect(data.agentRead).toHaveBeenCalledTimes(1);
    expect(data.backendRead).toHaveBeenCalledTimes(2);
    expect(data.standardRead).toHaveBeenCalledTimes(1);
  });

  it('builds one directory and one access decision for many nested rows', () => {
    render(
      <ActorDirectoryBoundary
        organizationId="org-1"
        projectId="project-1"
        assignable
      >
        {Array.from({ length: 200 }, (_, index) => (
          <ActorDirectoryBoundary
            key={index}
            organizationId="org-1"
            projectId="project-1"
            assignable
          >
            <Reader organizationId="org-1" projectId="project-1" candidates />
          </ActorDirectoryBoundary>
        ))}
      </ActorDirectoryBoundary>,
    );
    expect(screen.getAllByText('Ada')).toHaveLength(200);
    expect(screen.getAllByText('1 candidates')).toHaveLength(200);
    expect(data.memberRead).toHaveBeenCalledTimes(1);
    expect(data.agentRead).toHaveBeenCalledTimes(1);
    expect(data.backendRead).toHaveBeenCalledTimes(2);
    expect(data.standardRead).toHaveBeenCalledTimes(1);
  });

  it('never shares a directory across an organization or project boundary', () => {
    render(
      <ActorDirectoryBoundary organizationId="org-1" projectId="project-1">
        <Reader organizationId="org-1" projectId="project-1" />
        <ActorDirectoryBoundary organizationId="org-1" projectId="project-2">
          <Reader organizationId="org-1" projectId="project-2" />
        </ActorDirectoryBoundary>
        <ActorDirectoryBoundary organizationId="org-2" projectId="project-1">
          <Reader organizationId="org-2" projectId="project-1" />
        </ActorDirectoryBoundary>
      </ActorDirectoryBoundary>,
    );
    expect(data.memberRead.mock.calls.map(([org]) => org)).toEqual([
      'org-1',
      'org-1',
      'org-2',
    ]);
    expect(data.agentRead.mock.calls.map(([project]) => project)).toEqual([
      'project-1',
      'project-2',
      'project-1',
    ]);
  });

  it('reads project agents inside an organization-level parent instead of sharing its empty project directory', () => {
    render(
      <ActorDirectoryBoundary organizationId="org-1">
        <Reader organizationId="org-1" />
        <ActorDirectoryBoundary organizationId="org-1" projectId="project-1">
          <Reader organizationId="org-1" projectId="project-1" />
        </ActorDirectoryBoundary>
      </ActorDirectoryBoundary>,
    );
    expect(data.agentRead.mock.calls.map(([project]) => project)).toEqual([
      undefined,
      'project-1',
    ]);
    expect(data.memberRead).toHaveBeenCalledTimes(2);
  });

  it('retains historical actor display when project access excludes that actor from candidates', () => {
    data.scope.orgWide = false;
    render(
      <ActorDirectoryBoundary
        organizationId="org-1"
        projectId="project-1"
        assignable
      >
        <Reader organizationId="org-1" projectId="project-1" candidates />
      </ActorDirectoryBoundary>,
    );
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('0 candidates')).toBeInTheDocument();
    expect(data.memberRead).toHaveBeenCalledTimes(1);
  });

  it('keeps stable context consumers out of unrelated parent state updates', () => {
    function Harness() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button onClick={() => setCount(count + 1)}>{count}</button>
          <ActorDirectoryBoundary
            organizationId="org-1"
            projectId="project-1"
            assignable
          >
            <Reader organizationId="org-1" projectId="project-1" />
          </ActorDirectoryBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(data.childRender).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(data.childRender).toHaveBeenCalledTimes(1);
  });
});
