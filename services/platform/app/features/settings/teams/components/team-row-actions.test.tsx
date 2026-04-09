import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { Team } from '../hooks/queries';
import { TeamRowActions } from './team-row-actions';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: {
      removeTeam: vi.fn(),
      updateTeam: vi.fn(),
    },
  },
}));

vi.mock('../hooks/mutations', () => ({
  useCreateTeamMember: () => ({ mutateAsync: vi.fn() }),
  useAddTeamMember: () => ({ mutateAsync: vi.fn() }),
  useRemoveTeamMember: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./team-edit-dialog', () => ({
  TeamEditDialog: () => null,
}));

vi.mock('./team-delete-dialog', () => ({
  TeamDeleteDialog: () => null,
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Engineering',
    createdAt: new Date(),
    ...overrides,
  } as Team;
}

describe('TeamRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <TeamRowActions team={makeTeam()} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
