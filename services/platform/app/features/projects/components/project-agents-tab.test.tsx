// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ProjectAgentsTab } from './project-agents-tab';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

const { state } = vi.hoisted(() => ({
  state: { canEdit: true, agents: [] as unknown[] },
}));

vi.mock('../hooks/queries', () => ({
  useProject: () => ({
    project: { _id: 'project-1', name: 'Website', canEdit: state.canEdit },
    isLoading: false,
  }),
  useProjectAgents: () => ({ agents: state.agents, isLoading: false }),
  useProjectHarnesses: () => ({ data: undefined }),
  useProjectCapabilityCatalog: () => ({ data: undefined }),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteProjectAgent: () => ({ mutateAsync: vi.fn() }),
}));

// The New agent form is its own component with its own writes.
vi.mock('./project-agent-dialog', () => ({ ProjectAgentDialog: () => null }));

function renderTab() {
  return render(
    <ProjectAgentsTab organizationId="org-1" projectId="project-1" />,
  );
}

describe('ProjectAgentsTab', () => {
  beforeEach(() => {
    state.canEdit = true;
    state.agents = [];
  });

  it('invites an editor to add the first agent', () => {
    renderTab();

    expect(
      screen.getByText('projects.agents.sectionDescription'),
    ).toBeInTheDocument();
    expect(screen.getByText('projects.agents.emptyTitle')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'projects.agents.newAgent' }),
    ).toBeInTheDocument();
  });

  it('tells a reader who adds agents instead of how to', () => {
    state.canEdit = false;
    renderTab();

    expect(
      screen.getByText('projects.agents.sectionDescriptionReader'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projects.agents.emptyReaderTitle'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projects.agents.emptyReaderBody'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('projects.agents.emptyBody'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'projects.agents.newAgent' }),
    ).not.toBeInTheDocument();
  });
});
