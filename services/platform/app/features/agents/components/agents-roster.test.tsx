// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

let agentsData:
  | {
      agents: Array<{
        slug: string;
        displayName: string;
        description?: string;
        visibility: 'private' | 'org';
        icon?: string;
        labels?: string[];
        knowledge: 'none' | 'documents' | 'web' | 'all';
        canEdit: boolean;
      }>;
      failures: Array<{ slug: string; path: string; message: string }>;
    }
  | undefined;
vi.mock('../hooks/queries', () => ({
  useAgents: () => ({ data: agentsData, isPending: false, isError: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestoreAgentFromHistory: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

import { AgentsRoster } from './agents-roster';

describe('AgentsRoster', () => {
  it('renders the viewer-visible agents with display names, flagging private ones', () => {
    agentsData = {
      agents: [
        {
          slug: 'coding-agent',
          displayName: 'Coding Agent',
          description: 'Writes and reviews code.',
          visibility: 'org',
          labels: ['engineering'],
          knowledge: 'all',
          canEdit: true,
        },
        {
          slug: 'my-helper',
          displayName: 'My Helper',
          visibility: 'private',
          knowledge: 'none',
          canEdit: true,
        },
      ],
      failures: [],
    };
    const onOpen = vi.fn();
    render(<AgentsRoster organizationId="org-1" onOpen={onOpen} />);

    expect(screen.getByText('Coding Agent')).toBeInTheDocument();
    expect(screen.getByText('My Helper')).toBeInTheDocument();
    expect(
      screen.getAllByText('settings.agents.visibility.private'),
    ).toHaveLength(1);
  });

  it('opens an agent on card click', async () => {
    agentsData = {
      agents: [
        {
          slug: 'coding-agent',
          displayName: 'Coding Agent',
          visibility: 'org',
          knowledge: 'all',
          canEdit: true,
        },
      ],
      failures: [],
    };
    const onOpen = vi.fn();
    const { user } = render(
      <AgentsRoster organizationId="org-1" onOpen={onOpen} />,
    );

    await user.click(screen.getByText('Coding Agent'));
    expect(onOpen).toHaveBeenCalledWith('coding-agent');
  });

  it('surfaces unreadable agent files as an operator banner', () => {
    agentsData = {
      agents: [],
      failures: [
        {
          slug: 'broken',
          path: 'agents/broken.yml',
          message: 'display-name is required',
        },
      ],
    };
    render(<AgentsRoster organizationId="org-1" onOpen={vi.fn()} />);

    expect(screen.getByText('settings.agents.loadError')).toBeInTheDocument();
    expect(screen.getByText('agents/broken.yml')).toBeInTheDocument();
  });
});
