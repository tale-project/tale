import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ApiKey } from '../types';
import { ApiKeyOwnerCell } from './api-key-owner-cell';

type OwnerFacts = Pick<ApiKey, 'owner' | 'role' | 'createdBy'>;

function renderCell(apiKey: OwnerFacts, viewerUserId = 'mia') {
  return render(
    <ApiKeyOwnerCell apiKey={apiKey} viewerUserId={viewerUserId} />,
  );
}

/** Whose a key is, and under it what the key acts as or who made it. */
describe('ApiKeyOwnerCell', () => {
  it('reads a person’s own key, and one made for the viewer, as theirs', () => {
    renderCell({ owner: { kind: 'user' }, role: null, createdBy: null });
    expect(screen.getByText('You')).toBeInTheDocument();

    renderCell({
      owner: { kind: 'member', userId: 'mia', name: 'Mia Keller', email: null },
      role: null,
      createdBy: { userId: 'ada', name: 'Ada' },
    });
    expect(screen.getAllByText('You')).toHaveLength(2);
    expect(screen.getByText('Made by Ada')).toBeInTheDocument();
  });

  it('names the member a key was made for, or a former member', () => {
    renderCell(
      {
        owner: {
          kind: 'member',
          userId: 'mia',
          name: 'Mia Keller',
          email: 'mia@example.test',
        },
        role: null,
        createdBy: { userId: 'ada', name: null },
      },
      'ada',
    );
    expect(screen.getByText('Mia Keller')).toBeInTheDocument();
    expect(screen.getByText('Made by Former member')).toBeInTheDocument();

    renderCell(
      {
        owner: { kind: 'member', userId: 'gone', name: null, email: null },
        role: null,
        createdBy: null,
      },
      'ada',
    );
    expect(screen.getByText('Former member')).toBeInTheDocument();
  });

  it('names a team’s, a project’s and the organization’s key with the role it acts as', () => {
    renderCell({
      owner: { kind: 'team', teamId: 'finance', teamName: 'Finance' },
      role: 'editor',
      createdBy: { userId: 'ada', name: 'Ada' },
    });
    expect(screen.getByText('Team Finance')).toBeInTheDocument();
    expect(screen.getByText('Acts as Editor')).toBeInTheDocument();

    renderCell({
      owner: { kind: 'project', projectId: 'launch', projectName: null },
      role: 'developer',
      createdBy: null,
    });
    expect(screen.getByText('Project deleted project')).toBeInTheDocument();

    renderCell({
      owner: { kind: 'organization' },
      role: 'admin',
      createdBy: null,
    });
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Acts as Admin')).toBeInTheDocument();
  });
});
