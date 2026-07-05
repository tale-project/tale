import { within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AgentSelector } from './agent-selector';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'agentSelector.label': 'Select agent',
        'agentSelector.defaultAgent': 'Default agent',
        'agentSelector.viewDetails': 'View agent details',
        'agentSelector.searchPlaceholder': 'Search agents...',
        'agentSelector.noResults': 'No agents found',
        'agentSelector.addAgent': 'Catalog',
        'agentSelector.lockedExternalLabel':
          'Agent: {agent} (pinned for this sandbox chat)',
      };
      const template = translations[key] ?? key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, replacement),
        template,
      );
    },
  }),
}));

const mockSetSelectedAgent = vi.fn();
let mockSelectedAgent: { name: string; displayName: string } | null = null;
vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedAgent: mockSelectedAgent,
    setSelectedAgent: mockSetSelectedAgent,
  }),
}));

// The selector reads a project to honor `allowedAgentSlugs`. These tests render
// without a project (org-level chat), so stub it to "no project" — also avoids
// pulling in the real Convex/react-query hook (no QueryClient in this harness).
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({ project: null }),
}));

interface MockAgent {
  name: string;
  displayName: string;
  description: string;
}

const defaultAgents: MockAgent[] = [
  {
    name: 'assistant',
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

vi.mock('../hooks/queries', () => ({
  useChatAgents: () => ({
    agents: mockAgents,
  }),
}));

let mockEffectiveAgent: { name: string; displayName: string } | null = {
  name: 'assistant',
  displayName: 'Default Chat',
};
let mockEffectiveAgentLoading = false;

vi.mock('../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({
    agent: mockEffectiveAgent,
    isLoading: mockEffectiveAgentLoading,
  }),
}));

let mockCanWrite = true;
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (_action: string, _subject: string) => mockCanWrite,
    cannot: (_action: string, _subject: string) => !mockCanWrite,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
  useNavigate: () => mockNavigate,
  // The "view agent details" row link renders a TanStack `Link`. Stub it as a
  // plain anchor so tests don't need a RouterProvider. Router-only props (`to`,
  // `params`) are dropped so React doesn't get object-valued DOM attributes.
  Link: ({
    children,
    'aria-label': ariaLabel,
    className,
    onClick,
  }: {
    children: ReactNode;
    'aria-label'?: string;
    className?: string;
    onClick?: (e: unknown) => void;
  }) => (
    // `href` gives the stub the implicit ARIA `link` role (getByRole('link')).
    // This is a router-Link test double, not real navigation — the a11y rule
    // about href+onClick anchors doesn't apply.
    // oxlint-disable-next-line jsx-a11y/anchor-is-valid
    <a href="#" aria-label={ariaLabel} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock('../hooks/use-composer-capabilities', () => ({
  useIntegrationReadiness: () => ({
    readyBySlug: new Map<string, boolean>(),
    titleBySlug: new Map<string, string>(),
  }),
  getAgentMissingIntegrations: () => [],
}));

let mockLockedAgent: { name: string; displayName: string } | null = null;
vi.mock('../hooks/use-thread-agent-lock', () => ({
  useThreadAgentLock: () => ({
    lockedAgent: mockLockedAgent,
    isLoading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanWrite = true;
  mockAgents = defaultAgents;
  mockEffectiveAgent = { name: 'assistant', displayName: 'Default Chat' };
  mockEffectiveAgentLoading = false;
  mockSelectedAgent = null;
  mockLockedAgent = null;
});

describe('AgentSelector', () => {
  it('renders the agent selector trigger', () => {
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByLabelText('Select agent')).toBeInTheDocument();
  });

  // External-agent threads are bound to their agent (sandbox session +
  // --resume transcript) — the selector pins instead of offering a switch,
  // even when the global per-user selection points elsewhere.
  describe('external-thread lock', () => {
    it('pins the locked agent and offers no picker', () => {
      mockLockedAgent = { name: 'claude-code', displayName: 'Claude Code' };
      mockSelectedAgent = { name: 'assistant', displayName: 'Default Chat' };
      render(<AgentSelector organizationId="org-1" threadId="thread-1" />);

      // The locked agent is shown, not the (stale) global selection…
      const trigger = screen.getByRole('button', {
        name: 'Agent: Claude Code (pinned for this sandbox chat)',
      });
      expect(within(trigger).getByText('Claude Code')).toBeInTheDocument();
      // …the control is marked non-interactive but stays focusable so the
      // explanatory tooltip can fire (aria-disabled, not native disabled)…
      expect(trigger).toHaveAttribute('aria-disabled', 'true');
      expect(trigger).not.toBeDisabled();
      // …and there is no combobox/listbox to switch with.
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('has no accessibility violations while locked', async () => {
      mockLockedAgent = { name: 'claude-code', displayName: 'Claude Code' };
      const { container } = render(
        <AgentSelector organizationId="org-1" threadId="thread-1" />,
      );
      await checkAccessibility(container);
    });
  });

  it('displays the effective agent name when an agent is pinned', () => {
    // With a pinned selection the trigger reflects that agent (not "Auto",
    // which is only the label when the selection is null/Auto).
    mockSelectedAgent = { name: 'assistant', displayName: 'Default Chat' };
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByText('Default Chat')).toBeInTheDocument();
  });

  it('falls back to translation when no effective agent', () => {
    // Single agent → "Auto" is not offered, so a null selection resolves to the
    // effective agent (here null) and falls back to the default-agent label.
    mockAgents = [defaultAgents[0]];
    mockEffectiveAgent = null;
    render(<AgentSelector organizationId="org-1" />);
    expect(screen.getByText('Default agent')).toBeInTheDocument();
  });

  it('renders a skeleton inside the trigger while the effective agent is loading', () => {
    mockAgents = [defaultAgents[0]];
    mockEffectiveAgent = null;
    mockEffectiveAgentLoading = true;
    render(<AgentSelector organizationId="org-1" />);

    // Granular masking: the real label stays mounted (so the footprint is
    // stable) but is wrapped in a `<SkeletonBox>` that covers it with a pulse
    // overlay while loading — there's no visual "Default agent" flash even
    // though the text node remains in the DOM (aria-hidden).
    const label = screen.getByText('Default agent');
    expect(label.closest('[aria-hidden="true"]')).not.toBeNull();
    const trigger = screen.getByRole('button', { name: 'Select agent' });
    expect(trigger).toBeDisabled();
    // Trigger keeps its leading + trailing icons so the width footprint is
    // stable across loading and loaded states.
    expect(trigger.querySelectorAll('svg')).toHaveLength(2);
    // The loading region is announced once via role="status"; the masked label
    // sits under a pulse overlay. Granular masking auto-sizes the overlay to the
    // label (no fixed skeleton dimensions), so assert the overlay is present
    // rather than brittle width/height classes.
    const skeleton = within(trigger).getByRole('status');
    expect(skeleton).toBeInTheDocument();
    expect(trigger.querySelector('.animate-pulse')).not.toBeNull();
    // Trigger has a min-width pin (from `sm` up) so loading→loaded never
    // reflows for the common label range. Mobile drops the pin so the
    // composer toolbar fits — see the source comment in agent-selector.tsx.
    expect(trigger).toHaveClass('sm:min-w-32');
  });

  it('shows the "Catalog" button when user has write permission', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    expect(screen.getByText('Catalog')).toBeInTheDocument();
  });

  it('hides the "Catalog" button when user lacks write permission', async () => {
    mockCanWrite = false;

    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    expect(screen.queryByText('Catalog')).not.toBeInTheDocument();
  });

  it('shows a "view agent details" link on each agent row (not Auto) for managers', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    await user.click(screen.getByLabelText('Select agent'));

    // One link per real agent (assistant + custom-agent), none on the Auto row.
    const links = screen.getAllByRole('link', { name: 'View agent details' });
    expect(links).toHaveLength(2);
    // The Auto option (a pseudo-agent) has no details link.
    const autoOption = screen
      .getAllByRole('option')
      .find((el) => el.textContent?.includes('agentSelector.auto'));
    expect(autoOption).toBeDefined();
    expect(
      within(autoOption as HTMLElement).queryByRole('link'),
    ).not.toBeInTheDocument();
  });

  it('hides the "view agent details" link when the user cannot manage agents', async () => {
    mockCanWrite = false;

    const { user } = render(<AgentSelector organizationId="org-1" />);

    await user.click(screen.getByLabelText('Select agent'));

    expect(
      screen.queryByRole('link', { name: 'View agent details' }),
    ).not.toBeInTheDocument();
  });

  it('does not select the agent when its details link is clicked', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    await user.click(screen.getByLabelText('Select agent'));

    const links = screen.getAllByRole('link', { name: 'View agent details' });
    await user.click(links[0]);

    // The link's onClick stops propagation, so the row's select handler must
    // not fire.
    expect(mockSetSelectedAgent).not.toHaveBeenCalled();
  });

  it('navigates to the agent catalog when "Catalog" is clicked', async () => {
    const { user } = render(<AgentSelector organizationId="org-1" />);

    const trigger = screen.getByLabelText('Select agent');
    await user.click(trigger);

    const addButton = screen.getByText('Catalog');
    await user.click(addButton);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/agents/catalog',
      params: { id: 'org-1' },
    });
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
      name: 'assistant',
      displayName: 'Default Chat',
    });
  });

  it('only highlights one agent when selected', async () => {
    mockAgents = [
      {
        name: 'assistant',
        displayName: 'Assistant',
        description: 'Default assistant',
      },
      {
        name: 'another-assistant',
        displayName: 'Another Chat',
        description: 'Also a chat agent',
      },
    ];
    mockEffectiveAgent = { name: 'assistant', displayName: 'Assistant' };
    // Pin the agent so the highlighted option is that agent rather than "Auto"
    // (the selected option when the selection is null/Auto).
    mockSelectedAgent = { name: 'assistant', displayName: 'Assistant' };

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

  // Mirrors the chat-depth e2e "agent picker lists the seeded agent": open the
  // picker, confirm the single seeded agent is offered as a selectable option,
  // pick it, and confirm the selection is committed and reflected on the
  // trigger. The seeded display name comes from the e2e fixture
  // (`SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant'`).
  describe('seeded agent picker (e2e parity)', () => {
    const seededAgent: MockAgent = {
      name: 'e2e-assistant',
      displayName: 'E2E Assistant',
      description: 'The seeded e2e agent',
    };

    it('lists the seeded agent as a selectable option and selecting it commits + reflects on the trigger', async () => {
      // A single seeded agent (as in the e2e fixture): "Auto" is not offered, so
      // the seeded agent is the effective + only option.
      mockAgents = [seededAgent];
      mockEffectiveAgent = {
        name: seededAgent.name,
        displayName: seededAgent.displayName,
      };

      const { user, rerender } = render(
        <AgentSelector organizationId="org-1" />,
      );

      const trigger = screen.getByRole('button', { name: 'Select agent' });
      // The e2e waits for the trigger to enable (it's disabled while the agent
      // resolves) before opening — here the effective agent is already loaded.
      expect(trigger).toBeEnabled();
      await user.click(trigger);

      // The seeded agent is listed as a selectable option in the open popover.
      const seededOption = screen
        .getAllByRole('option')
        .find((el) => el.textContent?.includes('E2E Assistant'));
      expect(seededOption).toBeDefined();

      await user.click(seededOption as HTMLElement);

      // Selecting it commits the seeded agent (the pin the e2e then observes on
      // the trigger).
      expect(mockSetSelectedAgent).toHaveBeenCalledWith({
        name: seededAgent.name,
        displayName: seededAgent.displayName,
      });

      // The trigger reflects the seeded agent once selected/resolved. Drive the
      // mocked layout selection to the committed value and re-render (the e2e
      // observes the trigger text after the click commits the selection).
      mockSelectedAgent = {
        name: seededAgent.name,
        displayName: seededAgent.displayName,
      };
      rerender(<AgentSelector organizationId="org-1" />);
      expect(
        within(screen.getByRole('button', { name: 'Select agent' })).getByText(
          'E2E Assistant',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<AgentSelector organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});
