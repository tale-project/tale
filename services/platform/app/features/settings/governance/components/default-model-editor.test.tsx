import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DefaultModelEditor } from './default-model-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: null,
    isLoading: false,
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [{ id: 'team-1', name: 'Engineering' }],
    isLoading: false,
  }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useListProviders: () => ({
    providers: [
      {
        name: 'openai',
        displayName: 'OpenAI',
        models: [
          {
            id: 'openai/gpt-4o',
            displayName: 'GPT-4o',
            tags: ['chat'],
          },
        ],
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

describe('DefaultModelEditor', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <DefaultModelEditor organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
