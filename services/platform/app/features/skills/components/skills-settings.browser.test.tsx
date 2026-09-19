import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SkillsSettings } from './skills-settings';

import '@tale/ui/globals.css';

const fixture = vi.hoisted(() => ({
  skills: [
    {
      slug: 'accessible-skill',
      description: 'Keyboard example',
      visibility: 'org',
      canEdit: true,
    },
  ],
  failures: [],
  teams: [],
}));

vi.mock('../hooks/queries', () => ({
  useSkills: () => ({ data: fixture, isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: fixture.teams }),
  // Visibility badges resolve team names through the org's directory.
  useTeamDirectory: () => ({ teams: fixture.teams, isLoading: false }),
}));
vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org1' }),
}));
vi.mock('./skill-create-dialog', () => ({ SkillCreateDialog: () => null }));
vi.mock('./skill-upload-dialog', () => ({ SkillUploadDialog: () => null }));
vi.mock('./skill-detail-pane', () => ({
  SkillDetailPane: () => <p>Skill contents</p>,
}));

afterEach(cleanup);

describe('Skills keyboard detail entry', () => {
  it('opens from the named action with Enter and restores focus on Escape', async () => {
    const { user } = render(<SkillsSettings organizationId="org1" />);
    const opener = screen.getByRole('button', { name: 'accessible-skill' });
    for (let tab = 0; tab < 12 && document.activeElement !== opener; tab++)
      await user.tab();
    expect(opener).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', {
      name: 'accessible-skill',
    });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard('{Escape}');
    expect(opener.isConnected).toBe(true);
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
