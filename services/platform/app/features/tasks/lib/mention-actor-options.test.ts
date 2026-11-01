// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignableActor } from '../hooks/use-actor-directory';
import { useMentionActorOptions } from './mention-actor-options';

vi.mock('../hooks/use-actor-directory', () => ({
  useAssignableActors: () => ({
    currentUserId: 'user-1',
    assignableAgents: [
      { type: 'agent', id: 'scribe', name: 'Scribe', handle: 'scribe' },
      {
        type: 'agent',
        id: 'coder',
        name: 'Coder',
        servedFrom: { projectId: 'development', projectName: 'Development' },
      },
    ],
  }),
}));

interface PeopleFound {
  members: AssignableActor[];
  more: boolean;
  searching: boolean;
  unavailable: boolean;
}
const NOBODY: PeopleFound = {
  members: [],
  more: false,
  searching: false,
  unavailable: false,
};
// The people are searched on the server for what is typed after `@`.
let people: PeopleFound = NOBODY;
const peopleSearches: Array<{
  projectId: string | undefined;
  query: string;
  access: string;
}> = [];
vi.mock('../hooks/use-assignable-members', () => ({
  useAssignableMembers: (
    _organizationId: string,
    projectId: string | undefined,
    query: string,
    access: string,
  ) => {
    peopleSearches.push({ projectId, query, access });
    return people;
  },
}));

vi.mock('../hooks/use-task-subject-contract', () => ({
  useTaskContractAutomations: () => [],
  taskSubjectEntries: () => [],
}));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

beforeEach(() => {
  people = NOBODY;
  peopleSearches.length = 0;
});

describe('who a comment on the board can mention', () => {
  it('offers the project’s own agents, never one another project’s dispatch puts to work here', () => {
    // The server resolves a mention among the project's own agents
    // (`mention-directory.ts`): an agent of the dispatch serving this board
    // would be offered for nothing.
    const { result } = renderHook(() =>
      useMentionActorOptions('org-1', 'project-1', ''),
    );
    expect(result.current.options.map((option) => option.id)).toEqual([
      'scribe',
    ]);
  });

  it('offers the readers the server finds for what is typed after @, never the viewer', () => {
    people = {
      ...NOBODY,
      members: [
        { type: 'user', id: 'user-1', name: 'Me', email: 'me@acme.example' },
        {
          type: 'user',
          id: 'user-2',
          name: 'Ada Lovelace',
          email: 'ada@acme.example',
        },
      ],
    };
    const { result } = renderHook(() =>
      useMentionActorOptions('org-1', 'project-1', 'ada'),
    );
    expect(peopleSearches.at(-1)).toEqual({
      projectId: 'project-1',
      query: 'ada',
      access: 'read',
    });
    expect(result.current.options.map((option) => option.id)).toEqual([
      'user-2',
      'scribe',
    ]);
    expect(result.current.options[0]).toMatchObject({
      type: 'user',
      name: 'Ada Lovelace',
      email: 'ada@acme.example',
      handle: 'ada',
    });
    expect(result.current.options[0]?.keywords).toContain('ada.lovelace');
  });

  it('says while the people are searched, when they could not be, and when more match', () => {
    people = { ...NOBODY, searching: true };
    const searching = renderHook(() =>
      useMentionActorOptions('org-1', 'project-1', 'a'),
    );
    expect(searching.result.current).toMatchObject({
      searching: true,
      unavailable: false,
      more: false,
    });

    people = { ...NOBODY, more: true };
    const more = renderHook(() =>
      useMentionActorOptions('org-1', 'project-1', 'a'),
    );
    expect(more.result.current).toMatchObject({
      searching: false,
      unavailable: false,
      more: true,
    });

    people = { ...NOBODY, unavailable: true };
    const failed = renderHook(() =>
      useMentionActorOptions('org-1', 'project-1', 'a'),
    );
    expect(failed.result.current).toMatchObject({
      searching: false,
      unavailable: true,
      more: false,
    });
    // The agents stay offered: only the people could not be searched.
    expect(failed.result.current.options.map((option) => option.id)).toEqual([
      'scribe',
    ]);
  });
});
