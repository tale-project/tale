import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TaskActorDirectoryProvider,
  TaskAssignableActorsProvider,
  useTaskActorDirectory,
  useTaskAssignableActors,
  withTaskActorDirectory,
  withTaskAssignableActors,
} from './task-actor-directory-context';
import {
  ActorDirectoryProvider,
  useProvidedActorDirectory,
} from './use-actor-directory';

const reads = vi.hoisted(() => ({
  directory: vi.fn(),
  assignable: vi.fn(),
  revision: 0,
}));

vi.mock('./use-actor-directory', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./use-actor-directory')>();
  const directory = (organizationId: string, projectId?: string) => {
    const name = `${organizationId}/${projectId ?? 'all'}/${reads.revision}`;
    const members = [{ id: 'user-1', name }];
    return {
      organizationId,
      projectId,
      members,
      agents: [],
      automations: [],
      resolveActor: () => ({ name }),
    };
  };
  return {
    ...original,
    useActorDirectory: (organizationId: string, projectId?: string) => {
      reads.directory(organizationId, projectId);
      return directory(organizationId, projectId);
    },
    useAssignableActors: (organizationId: string, projectId?: string) => {
      reads.assignable(organizationId, projectId);
      const value = directory(organizationId, projectId);
      return {
        ...value,
        assignableMembers: value.members,
        assignableAgents: [],
      };
    },
  };
});

const Actor = withTaskActorDirectory(function Actor({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  const directory = useTaskActorDirectory(organizationId, projectId);
  return <output>{directory.resolveActor('user', 'user-1').name}</output>;
});

const Candidate = withTaskAssignableActors(function Candidate({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  const directory = useTaskAssignableActors(organizationId, projectId);
  return <output>{directory.assignableMembers[0]?.name}</output>;
});

beforeEach(() => {
  reads.directory.mockClear();
  reads.assignable.mockClear();
  reads.revision = 0;
});

describe('task actor directory scope', () => {
  it('reuses an upstream provider without another loader or scope index', () => {
    render(
      <TaskActorDirectoryProvider organizationId="org-1" projectId="proj-1">
        <ActorDirectoryProvider organizationId="org-1" projectId="proj-1">
          {Array.from({ length: 100 }, (_entry, index) => (
            <Actor key={index} organizationId="org-1" projectId="proj-1" />
          ))}
        </ActorDirectoryProvider>
      </TaskActorDirectoryProvider>,
    );

    expect(screen.getAllByText('org-1/proj-1/0')).toHaveLength(100);
    expect(reads.directory).toHaveBeenCalledExactlyOnceWith('org-1', 'proj-1');
  });

  it('answers the upstream reader from a task scope and preserves identity', () => {
    function UpstreamReader() {
      const provided = useProvidedActorDirectory('org-1', 'proj-1');
      const otherOrg = useProvidedActorDirectory('org-2', 'proj-1');
      const otherProject = useProvidedActorDirectory('org-1', 'proj-2');
      return (
        <output>
          {provided?.organizationId}/{provided?.projectId}/
          {String(otherOrg === undefined)}/{String(otherProject === undefined)}
        </output>
      );
    }
    render(
      <TaskActorDirectoryProvider organizationId="org-1" projectId="proj-1">
        <UpstreamReader />
      </TaskActorDirectoryProvider>,
    );

    expect(screen.getByText('org-1/proj-1/true/true')).toBeInTheDocument();
    expect(reads.directory).toHaveBeenCalledExactlyOnceWith('org-1', 'proj-1');
  });

  it('loads once for a hundred matching history entries', () => {
    render(
      <TaskActorDirectoryProvider organizationId="org-1" projectId="proj-1">
        {Array.from({ length: 100 }, (_entry, index) => (
          <Actor key={index} organizationId="org-1" projectId="proj-1" />
        ))}
      </TaskActorDirectoryProvider>,
    );

    expect(screen.getAllByText('org-1/proj-1/0')).toHaveLength(100);
    expect(reads.directory).toHaveBeenCalledExactlyOnceWith('org-1', 'proj-1');
  });

  it('provides standalone entries and isolates different projects and organizations', () => {
    render(
      <TaskActorDirectoryProvider organizationId="org-1" projectId="proj-1">
        <Actor organizationId="org-1" projectId="proj-1" />
        <Actor organizationId="org-1" projectId="proj-2" />
        <Actor organizationId="org-2" projectId="proj-1" />
      </TaskActorDirectoryProvider>,
    );

    expect(screen.getByText('org-1/proj-1/0')).toBeInTheDocument();
    expect(screen.getByText('org-1/proj-2/0')).toBeInTheDocument();
    expect(screen.getByText('org-2/proj-1/0')).toBeInTheDocument();
    expect(reads.directory.mock.calls).toEqual([
      ['org-1', 'proj-1'],
      ['org-1', 'proj-2'],
      ['org-2', 'proj-1'],
    ]);
  });

  it('updates memoized readers when a live directory changes', () => {
    const view = () => (
      <TaskActorDirectoryProvider organizationId="org-1" projectId="proj-1">
        <Actor organizationId="org-1" projectId="proj-1" />
      </TaskActorDirectoryProvider>
    );
    const { rerender } = render(view());
    reads.revision = 1;
    rerender(view());

    expect(screen.getByText('org-1/proj-1/1')).toBeInTheDocument();
    expect(screen.queryByText('org-1/proj-1/0')).toBeNull();
  });

  it('shares assignment access reads and the display directory', () => {
    render(
      <TaskAssignableActorsProvider organizationId="org-1" projectId="proj-1">
        {Array.from({ length: 100 }, (_entry, index) => (
          <Candidate key={index} organizationId="org-1" projectId="proj-1" />
        ))}
        <Actor organizationId="org-1" projectId="proj-1" />
      </TaskAssignableActorsProvider>,
    );

    expect(screen.getAllByText('org-1/proj-1/0')).toHaveLength(101);
    expect(reads.assignable).toHaveBeenCalledExactlyOnceWith('org-1', 'proj-1');
    expect(reads.directory).not.toHaveBeenCalled();
  });
});
