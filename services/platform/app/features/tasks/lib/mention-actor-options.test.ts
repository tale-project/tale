// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMentionActorOptions } from './mention-actor-options';

vi.mock('../hooks/use-actor-directory', () => ({
  useAssignableActors: () => ({
    currentUserId: 'user-1',
    assignableMembers: [],
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

vi.mock('../hooks/use-task-subject-contract', () => ({
  useTaskContractAutomations: () => [],
  taskSubjectEntries: () => [],
}));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

describe('who a comment on the board can mention', () => {
  it('offers the project’s own agents, never one another project’s dispatch puts to work here', () => {
    // The server resolves a mention among the project's own agents
    // (`mention-directory.ts`): an agent of the dispatch serving this board
    // would be offered for nothing.
    const { result } = renderHook(() =>
      useMentionActorOptions('org-1', 'project-1'),
    );
    expect(result.current.map((option) => option.id)).toEqual(['scribe']);
  });
});
