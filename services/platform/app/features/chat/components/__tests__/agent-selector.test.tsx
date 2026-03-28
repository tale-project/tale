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
  name: string;
  displayName: string;
  description: string;
}

const defaultAgents: MockAgent[] = [
  {
    name: 'chat-agent',
    displayName: 'Default Chat',
    description: 'Default assistant',
  },
  {
    name: 'custom-agent',
    displayName: 'Custom Agent',
    description: 'A custom agent',
  },
];

let mockAgents: MockAgent[] = defaultAgents;

vi.mock('../../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: mockAgents,
  }),
}));

let mockEffectiveAgent: { name: string; displayName: string } | null = {
  name: 'chat-agent',
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

vi.mock('@/app/features/agents/components/agent-create-dialog', () => ({
  CreateAgentDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string;
  }) =>
    open ? (
      <div data-testid="create-agent-dialog">Create Agent Dialog</div>
    ) : null,
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockCanWrite = true;
  mockDialogIsOpen = false;
  mockAgents = defaultAgents;
  mockEffectiveAgent = { name: 'chat-agent', displayName: 'Default Chat' };
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

  it('renders CreateAgentDialog when dialog is open', () => {
    mockDialogIsOpen = true;

    render(<AgentSelector organizationId="org-1" />);

    expect(screen.getByTestId('create-agent-dialog')).toBeInTheDocument();
  });

  it('does not render CreateAgentDialog when dialog is closed', () => {
    mockDialogIsOpen = false;

    render(<AgentSelector organizationId="org-1" />);

    expect(screen.queryByTestId('create-agent-dialog')).not.toBeInTheDocument();
  });

  it('calls setSelectedAgent with agent name when option is clicked', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const customOption = screen.getByText('Custom Agent');
    await user.click(customOption);

    expect(mockSetSelectedAgent).toHaveBeenCalledWith({
      name: 'custom-agent',
      displayName: 'Custom Agent',
    });
  });

  it('calls setSelectedAgent with name for default agent', async () => {
    mockEffectiveAgent = { name: 'custom-agent', displayName: 'Custom Agent' };

    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const defaultOption = screen.getByText('Default Chat');
    await user.click(defaultOption);

    expect(mockSetSelectedAgent).toHaveBeenCalledWith({
      name: 'chat-agent',
      displayName: 'Default Chat',
    });
  });

  it('only highlights one agent when selected', async () => {
    mockAgents = [
      {
        name: 'chat-agent',
        displayName: 'Assistant',
        description: 'Default assistant',
      },
      {
        name: 'another-chat-agent',
        displayName: 'Another Chat',
        description: 'Also a chat agent',
      },
    ];
    mockEffectiveAgent = { name: 'chat-agent', displayName: 'Assistant' };

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
