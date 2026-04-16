import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { Team } from '../hooks/queries';
import { TeamDeleteDialog } from './team-delete-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: {
      removeTeam: vi.fn(),
    },
  },
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Engineering',
    memberCount: 5,
    createdAt: Date.now(),
    ...overrides,
  } as Team;
}

describe('TeamDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <TeamDeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          team={makeTeam()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <TeamDeleteDialog
          open={false}
          onOpenChange={vi.fn()}
          team={makeTeam()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
