import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectAgentsTab } from './project-agents-tab';

const { state } = vi.hoisted(() => ({
  state: { canEdit: true, agents: [] as unknown[] },
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
  useStandardAgent: () => ({ enabled: true, available: false }),
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteProjectAgent: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
}));
vi.mock('./project-agent-dialog', () => ({ ProjectAgentDialog: () => null }));

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'projects', ...options });
const menuOf = (name: string) =>
  screen.getByRole('button', { name: t('agents.rowActionsLabel', { name }) });

function agent(name: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: `agent-${name}`,
    name,
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
    ...overrides,
  };
}

function renderTab() {
  return render(
    <ProjectAgentsTab organizationId="org-1" projectId="project-1" />,
  );
}

describe('ProjectAgentsTab rows', () => {
  beforeEach(() => {
    state.canEdit = true;
    state.agents = [agent('Writer'), agent('Reviewer')];
  });

  it('names each row menu by its agent and offers an editor View, Edit and Delete', async () => {
    const { user } = renderTab();

    expect(menuOf('Writer')).toHaveAccessibleName('Actions for Writer');
    expect(menuOf('Reviewer')).toBeInTheDocument();
    await user.click(menuOf('Writer'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['View', 'Edit', 'Delete']);
    // Delete is destructive: the shared menu sets it apart.
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
  });

  it('offers a reader View alone', async () => {
    state.canEdit = false;
    const { user } = renderTab();

    await user.click(menuOf('Writer'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['View']);
  });

  it('opens the details from the agent name as from View', async () => {
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: 'Writer' }));
    const fromName = await screen.findByRole('dialog');
    expect(within(fromName).getByText('Agent details')).toBeInTheDocument();
    expect(within(fromName).getByText('Drafts copy.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Writer' })).toHaveFocus();

    await user.click(menuOf('Reviewer'));
    await user.click(await screen.findByRole('menuitem', { name: 'View' }));
    const fromMenu = await screen.findByRole('dialog');
    expect(within(fromMenu).getByText('Reviewer')).toBeInTheDocument();
    await user.click(within(fromMenu).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The menu is gone by now: focus goes back to the button that opened it.
    await waitFor(() => expect(menuOf('Reviewer')).toHaveFocus());
  });

  it('lays the details out as settings rows, labels above their values', async () => {
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: 'Writer' }));
    const dialog = await screen.findByRole('dialog');
    const rows = dialog.querySelectorAll('[data-settings-field-row]');
    // Agent runtime, Model and Instructions are Governance's labels for the
    // standard agent's settings.
    expect(
      [...rows].map((row) => row.querySelector('span')?.textContent),
    ).toEqual([
      'Agent runtime',
      'Provider',
      'Model',
      'Skills',
      'Connectors',
      'Platform tools',
      'Instructions',
    ]);
    expect(dialog.querySelector('dl')).toBeNull();
    expect(within(dialog).getByText('None')).toHaveClass(
      'text-muted-foreground',
    );
    await checkAccessibility(document.body);
  });

  it('has no axe violations with its rows and an open menu', async () => {
    const { container, user } = renderTab();

    await checkAccessibility(container);
    await user.click(menuOf('Writer'));
    // The menu is portaled, and leaves the page around it to the reader.
    await checkAccessibility(await screen.findByRole('menu'));
  });
});
