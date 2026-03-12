import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { AgentSelector } from '../agent-selector';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'agentSelector.label': 'Select agent',
        'agentSelector.defaultAgent': 'Default agent',
        'agentSelector.searchPlaceholder': 'Search agents...',
        'agentSelector.noResults': 'No agents found',
        'agentSelector.addAgent': 'Add agent',
        'agentSelector.configureAgent': 'Configure agent',
      };
      return translations[key] ?? key;
    },
  }),
}));

const mockSetSelectedAgent = vi.fn();
vi.mock('../../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedAgent: null,
    setSelectedAgent: mockSetSelectedAgent,
  }),
}));

interface MockAgent {
  _id: string;
  rootVersionId: string | null;
  displayName: string;
  description: string;
  isSystemDefault: boolean;
  systemAgentSlug: string | null;
}

const defaultAgents: MockAgent[] = [
  {
    _id: 'agent-1',
    rootVersionId: null,
    displayName: 'Default Chat',
    description: 'Default assistant',
    isSystemDefault: true,
    systemAgentSlug: 'chat',
  },
  {
    _id: 'agent-2',
    rootVersionId: 'root-2',
    displayName: 'Custom Agent',
    description: 'A custom agent',
    isSystemDefault: false,
    systemAgentSlug: null,
  },
];

let mockAgents: MockAgent[] = defaultAgents;

vi.mock('../../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: mockAgents,
  }),
}));

let mockEffectiveAgent: { _id: string; displayName: string } | null = {
  _id: 'agent-1',
  displayName: 'Default Chat',
};

vi.mock('../../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => mockEffectiveAgent,
}));

let mockCanWrite = true;
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (_action: string, _subject: string) => mockCanWrite,
    cannot: (_action: string, _subject: string) => !mockCanWrite,
  }),
}));

const mockDialogOpen = vi.fn();
const mockDialogClose = vi.fn();
const mockDialogOnOpenChange = vi.fn();
let mockDialogIsOpen = false;

vi.mock('@/app/hooks/use-dialog-search-param', () => ({
  useDialogSearchParam: () => ({
    isOpen: mockDialogIsOpen,
    open: mockDialogOpen,
    close: mockDialogClose,
    onOpenChange: mockDialogOnOpenChange,
  }),
}));

vi.mock(
  '@/app/features/custom-agents/components/custom-agent-create-dialog',
  () => ({
    CreateCustomAgentDialog: ({
      open,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      organizationId: string;
    }) =>
      open ? (
        <div data-testid="create-agent-dialog">Create Agent Dialog</div>
      ) : null,
  }),
);

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockCanWrite = true;
  mockDialogIsOpen = false;
  mockAgents = defaultAgents;
  mockEffectiveAgent = { _id: 'agent-1', displayName: 'Default Chat' };
});

describe('AgentSelector', () => {
  it('renders the agent selector trigger', () => {
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByLabelText('Select agent')).toBeInTheDocument();
  });

  it('displays the effective agent name', () => {
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByText('Default Chat')).toBeInTheDocument();
  });

  it('falls back to translation when no effective agent', () => {
    mockEffectiveAgent = null;
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByText('Default agent')).toBeInTheDocument();
  });

  it('shows "Add agent" button when user has write permission', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    expect(screen.getByText('Add agent')).toBeInTheDocument();
  });

  it('hides "Add agent" button when user lacks write permission', async () => {
    mockCanWrite = false;

    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    expect(screen.queryByText('Add agent')).not.toBeInTheDocument();
  });

  it('opens create dialog when "Add agent" is clicked', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const addButton = screen.getByText('Add agent');
    await user.click(addButton);

    expect(mockDialogOpen).toHaveBeenCalled();
  });

  it('renders CreateCustomAgentDialog when dialog is open', () => {
    mockDialogIsOpen = true;

    render(<AgentSelector organizationId="org-1" />);

    expect(screen.getByTestId('create-agent-dialog')).toBeInTheDocument();
  });

  it('does not render CreateCustomAgentDialog when dialog is closed', () => {
    mockDialogIsOpen = false;

    render(<AgentSelector organizationId="org-1" />);

    expect(screen.queryByTestId('create-agent-dialog')).not.toBeInTheDocument();
  });

  it('calls setSelectedAgent with real agent ID when option is clicked', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const customOption = screen.getByText('Custom Agent');
    await user.click(customOption);

    expect(mockSetSelectedAgent).toHaveBeenCalledWith({
      _id: 'root-2',
      displayName: 'Custom Agent',
    });
  });

  it('calls setSelectedAgent with real ID even for system default agent', async () => {
    mockEffectiveAgent = { _id: 'root-2', displayName: 'Custom Agent' };

    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const defaultOption = screen.getByText('Default Chat');
    await user.click(defaultOption);

    expect(mockSetSelectedAgent).toHaveBeenCalledWith({
      _id: 'agent-1',
      displayName: 'Default Chat',
    });
  });

  it('shows configure button for all agents when user has write permission', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const configButtons = screen.getAllByLabelText('Configure agent');
    expect(configButtons).toHaveLength(2);
  });

  it('does not show configure button when user lacks write permission', async () => {
    mockCanWrite = false;

    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    expect(screen.queryByLabelText('Configure agent')).not.toBeInTheDocument();
  });

  it('navigates to agent config when configure button is clicked', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const configButtons = screen.getAllByLabelText('Configure agent');
    const customAgentConfig = configButtons[1];
    expect(customAgentConfig).toBeDefined();
    await user.click(customAgentConfig);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/custom-agents/$agentId',
      params: { id: 'org-1', agentId: 'root-2' },
    });
  });

  it('only highlights one agent when multiple have isSystemDefault', async () => {
    mockAgents = [
      {
        _id: 'agent-1',
        rootVersionId: null,
        displayName: 'Assistant',
        description: 'Default assistant',
        isSystemDefault: true,
        systemAgentSlug: 'chat',
      },
      {
        _id: 'agent-3',
        rootVersionId: 'root-3',
        displayName: 'Duplicated Default',
        description: 'Also marked as default',
        isSystemDefault: true,
        systemAgentSlug: 'chat',
      },
    ];
    mockEffectiveAgent = { _id: 'agent-1', displayName: 'Assistant' };

    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const selectedOptions = screen.getAllByRole('option');
    const selected = selectedOptions.filter(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Assistant');
  });
});
