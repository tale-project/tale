// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ProjectAgentsTab } from './project-agents-tab';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

const { state } = vi.hoisted(() => ({
  state: { canEdit: true, agents: [] as unknown[], standardAgent: false },
}));

vi.mock('../hooks/queries', () => ({
  useProject: () => ({
    project: { _id: 'project-1', name: 'Website', canEdit: state.canEdit },
    isLoading: false,
  }),
  useProjectAgents: () => ({
    agents: state.agents,
    hasAnswer: true,
    isLoading: false,
  }),
  useProjectHarnesses: () => ({ data: undefined }),
  useProjectCapabilityCatalog: () => ({ data: undefined }),
  useStandardAgent: () => ({
    enabled: true,
    available: state.standardAgent,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteProjectAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
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
    state.standardAgent = false;
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

  it('says the standard agent takes the tasks of a project without agents, by who is looking', () => {
    state.standardAgent = true;
    const { unmount } = renderTab();

    expect(
      screen.getByText('projects.agents.standard.emptyTitle'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projects.agents.standard.emptyBody'),
    ).toBeInTheDocument();
    unmount();

    state.canEdit = false;
    renderTab();
    expect(
      screen.getByText('projects.agents.standard.emptyReaderBody'),
    ).toBeInTheDocument();
  });

  it('opens read-only details from an agent row', async () => {
    state.agents = [
      {
        _id: 'agent-1',
        name: 'Writer',
        organizationId: 'org-1',
        projectId: 'project-1',
        harness: 'codex',
        model: 'gpt-6.1',
        modelProvider: 'openai',
        skills: ['docx'],
        connectors: [],
        tools: [],
        instructions: 'Drafts copy.',
        managed: false,
      },
    ];
    const { user } = renderTab();
    await user.click(
      screen.getByRole('button', { name: 'projects.agents.rowView' }),
    );
    expect(
      await screen.findByText('projects.agents.detailsTitle'),
    ).toBeInTheDocument();
    expect(screen.getByText('Drafts copy.')).toBeInTheDocument();
  });

  it('marks the standard agent and offers no edit for it, while it stays removable', () => {
    state.agents = [
      {
        _id: 'agent-standard',
        name: 'Standard agent',
        harness: 'claude-code',
        model: 'claude-sonnet-5',
        skills: ['docx'],
        connectors: [],
        managed: true,
      },
    ];
    renderTab();

    expect(
      screen.getByText('projects.agents.standard.badge'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projects.agents.standard.managedNote'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'projects.agents.rowEdit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'projects.agents.rowDelete' }),
    ).toBeInTheDocument();
  });
});
