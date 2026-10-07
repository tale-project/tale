import { render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import { useActorDirectory } from '../hooks/use-actor-directory';
import { TaskCommentView } from './task-comments';

const state = vi.hoisted(() => ({ locale: 'en', agentsLoaded: true }));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: state.locale }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (namespace: string) => ({
    t: i18n.getFixedT(state.locale, namespace),
  }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectAgents: () => ({
    agents: state.agentsLoaded
      ? [{ _id: 'fixture-reviewer', name: 'Fixture reviewer' }]
      : [],
    isLoading: !state.agentsLoaded,
  }),
  useStandardAgent: () => undefined,
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { role: 'member' } }),
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
  useEditTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Jan 1, 2026',
  }),
}));

vi.mock('./mention-text', () => ({
  MentionText: ({ body }: { body: string }) => <p>{body}</p>,
}));

const LOCALES = [
  {
    locale: 'en',
    automation: 'Automation',
    system: 'System',
    deleted: 'Deleted agent',
  },
  {
    locale: 'de',
    automation: 'Automatisierung',
    system: 'System',
    deleted: 'Gelöschter Agent',
  },
  {
    locale: 'fr',
    automation: 'Automatisation',
    system: 'Système',
    deleted: 'Agent supprimé',
  },
  {
    locale: 'de-CH',
    automation: 'Automatisierung',
    system: 'System',
    deleted: 'Gelöschter Agent',
  },
];

describe.each(LOCALES)(
  'task authors in $locale',
  ({ locale, automation, system, deleted }) => {
    afterEach(() => vi.unstubAllGlobals());

    beforeEach(() => {
      state.locale = locale;
      state.agentsLoaded = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error(
            'Network access is forbidden in the actor regression',
          );
        }),
      );
    });

    it('distinguishes workflow, system, live and deleted agents in the real directory', () => {
      const { result } = renderHook(() =>
        useActorDirectory('fixture-org', 'fixture-project'),
      );
      for (const [actorId, name] of [
        ['workflow', automation],
        ['system', system],
        ['fixture-reviewer', 'Fixture reviewer'],
        ['removed-agent', deleted],
      ]) {
        expect(result.current.resolveActor('agent', actorId)).toEqual({
          type: 'agent',
          id: actorId,
          name,
          isAgent: true,
        });
      }
      expect(
        result.current.resolveActorPreview('agent', 'workflow'),
      ).toBeNull();
      expect(result.current.agents.map((agent) => agent.id)).toEqual([
        'fixture-reviewer',
      ]);
    });

    it('names the reserved workflow even before the roster loads', () => {
      state.agentsLoaded = false;
      const { result } = renderHook(() =>
        useActorDirectory('fixture-org', 'fixture-project'),
      );
      expect(result.current.resolveActor('agent', 'workflow').name).toBe(
        automation,
      );
    });

    it.each([
      { actorId: 'workflow', label: automation },
      { actorId: 'system', label: system },
      { actorId: 'fixture-reviewer', label: 'Fixture reviewer' },
      { actorId: 'removed-agent', label: deleted },
    ])(
      'renders the real comment author and accessible avatar for $actorId',
      ({ actorId, label }) => {
        render(
          <TaskCommentView
            comment={{
              messageId: 'fixture-comment',
              authorType: 'agent',
              authorId: actorId,
              body: 'Synthetic receipt retained unchanged.',
              createdAt: 1_700_000_000_000,
            }}
            organizationId="fixture-org"
            projectId="fixture-project"
            canComment={false}
            onRequestDelete={vi.fn()}
          />,
        );
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.getByRole('img', { name: label })).toHaveAttribute(
          'title',
          label,
        );
        expect(
          screen.getByText('Synthetic receipt retained unchanged.'),
        ).toBeInTheDocument();
        if (actorId === 'workflow') {
          expect(screen.queryByText(deleted)).not.toBeInTheDocument();
          expect(
            screen.queryByRole('button', { name: label }),
          ).not.toBeInTheDocument();
        }
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  },
);
