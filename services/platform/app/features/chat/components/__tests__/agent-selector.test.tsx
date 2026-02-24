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

vi.mock('../../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: [
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
        displayName: 'Agent',
        description: 'A custom agent',
        isSystemDefault: false,
        systemAgentSlug: null,
      },
    ],
  }),
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

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockCanWrite = true;
  mockDialogIsOpen = false;
});

describe('AgentSelector', () => {
  it('renders the agent selector trigger', () => {
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByLabelText('Select agent')).toBeInTheDocument();
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
});
