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
      name: automation.name,
      description: automation.description ?? '',
    }),
}));

vi.mock('../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: () => ({
    required: [],
    blockedSlugs: [],
    isLoading: false,
  }),
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

describe('AutomationConfiguration — workflow update-exempt notice', () => {
  it('shows a dismissible info notice in the Workflows section when the automation has ≥1 workflow', async () => {
    const { user } = render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation({
          workflows: ['sample-automation/flow'],
        })}
      />,
    );

    expect(
      screen.getByText('This workflow keeps its own steps'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByText('This workflow keeps its own steps'),
    ).not.toBeInTheDocument();
    // The workflow row itself stays — only the notice is dismissed.
    expect(screen.getByText('Flow')).toBeInTheDocument();
  });

  it('never shows the notice when the automation declares no workflow', () => {
    render(
      <AutomationConfiguration
        organizationId="org_1"
        automationSlug="sample-automation"
        automation={catalogAutomation({ workflows: [] })}
      />,
    );

    expect(
      screen.queryByText('This workflow keeps its own steps'),
    ).not.toBeInTheDocument();
  });
});
