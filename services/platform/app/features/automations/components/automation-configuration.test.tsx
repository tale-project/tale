import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AutomationSummary } from '../hooks/use-automations';
import { AutomationConfiguration } from './automation-configuration';

// The resource rows render router `Link`s; no router mounts in this unit test.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children?: ReactNode;
    className?: string;
    to?: string;
  }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));

vi.mock('../hooks/use-automation-agent-readiness', () => ({
  useAutomationAgentReadiness: () => ({
    agents: [],
    externalAgents: [],
    isLoading: false,
    refetch: () => {},
  }),
}));

vi.mock('../hooks/use-automation-text', () => ({
  useAutomationDisplay:
    () => (automation: { name: string; description?: string }) => ({
      name: `LOCALIZED ${automation.name}`,
      description: automation.description ?? '',
    }),
}));

// Developer-gating: presettable per test (default non-developer).
const { abilityMock } = vi.hoisted(() => ({
  abilityMock: { can: vi.fn(() => false) },
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => abilityMock,
}));

// The identity/runtime form's data plumbing — Convex actions + the workflow
// read — stubbed to their call shapes; saving isn't exercised here.
const { readWorkflowMock } = vi.hoisted(() => ({
  readWorkflowMock: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  })),
}));
vi.mock('@/app/features/workflows/hooks/file-queries', () => ({
  useReadWorkflow: readWorkflowMock,
}));
vi.mock('@/app/features/workflows/hooks/file-mutations', () => ({
  useSaveWorkflow: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-update-automation-identity', () => ({
  useUpdateAutomationIdentity: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-automations')>()),
  useInvalidateAutomations: () => vi.fn(),
}));
vi.mock('@/app/features/workflows/components/workflow-env-editor', () => ({
  WorkflowEnvEditor: () => <div data-testid="env-editor" />,
}));

function catalogAutomation(
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    slug: 'sample-automation',
    name: 'Sample Automation',
    description: 'A discoverable automation from the built-in catalog.',
    scope: 'org',
    kind: 'automation',
    workflows: [],
    agents: [],
    skills: [],
    functions: [],
    requiredIntegrations: [],
    views: [],
    ...overrides,
  };
}

describe('AutomationConfiguration — identity', () => {
  it('shows the localized identity read-only for a non-developer', () => {
    abilityMock.can.mockReturnValue(false);
    render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation()}
      />,
    );

    expect(screen.getByText('LOCALIZED Sample Automation')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders the editable identity form (RAW manifest literals) for a developer', () => {
    abilityMock.can.mockReturnValue(true);
    render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation()}
      />,
    );

    // The form edits the English source strings, never the localized display.
    expect(screen.getByLabelText('Name')).toHaveValue('Sample Automation');
    expect(screen.getByLabelText('Description')).toHaveValue(
      'A discoverable automation from the built-in catalog.',
    );
    // No workflow → no runtime settings, no env editor.
    expect(screen.queryByText('Workflow settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('env-editor')).not.toBeInTheDocument();
  });

  it('adds the workflow runtime settings + env editor when the automation has a workflow', () => {
    abilityMock.can.mockReturnValue(true);
    readWorkflowMock.mockReturnValue({
      data: {
        ok: true,
        hash: 'h1',
        config: {
          steps: [],
          config: {
            timeout: 120000,
            retryPolicy: { maxRetries: 2, backoffMs: 500 },
          },
        },
      } as never,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation({ workflows: ['sample-automation'] })}
      />,
    );

    expect(screen.getByText('Workflow settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Timeout (ms)')).toHaveValue(120000);
    expect(screen.getByTestId('env-editor')).toBeInTheDocument();
  });
});

describe('AutomationConfiguration — entity sections', () => {
  it('lists the manifest cast without Workflows or Integrations sections', () => {
    abilityMock.can.mockReturnValue(false);
    render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation({
          agents: ['sample-automation-helper'],
          skills: ['browse-web'],
        })}
      />,
    );

    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Sample Automation Helper')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Browse Web')).toBeInTheDocument();
    // The Editor tab IS the workflow and Integrations have their own tab.
    expect(screen.queryByText('Workflows')).not.toBeInTheDocument();
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument();
  });

  it('shows the empty state for a bare automation', () => {
    abilityMock.can.mockReturnValue(false);
    render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Nothing to manage yet', level: 3 }),
    ).toBeInTheDocument();
  });
});
