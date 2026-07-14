// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Regression coverage for #2682: the agent-type RadioGroup lived under a
// PageSection heading but had no accessible name — screen readers could not
// discover which fieldset the three type options belonged to.

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: () => ({ id: 'org-1', agentId: 'agent-1' }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    ...config,
  }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));

vi.mock('@/app/features/agents/hooks/mutations', () => ({
  useUpdateAgentBindings: () => ({ mutateAsync: vi.fn() }),
  useUpdateAgentSharing: () => ({ mutateAsync: vi.fn() }),
  useTranslateAgentFields: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/features/agents/hooks/queries', () => ({
  useAgentBinding: () => ({ data: null }),
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({ data: null }),
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: () => ({ teams: [] }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

import { AgentConfigProvider } from '@/app/features/agents/hooks/use-agent-config-context';

import { Route } from './index';

// The router-mock above replaces `createFileRoute` so `Route` is the plain
// config object (component included); the real Route type doesn't expose it.
const GeneralTab = (Route as unknown as { component: () => React.ReactElement })
  .component;

function renderGeneralTab() {
  return render(
    <AgentConfigProvider
      agentName="agent-1"
      initialConfig={{ supportedModels: [] }}
    >
      <GeneralTab />
    </AgentConfigProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('GeneralTab agent-type radiogroup a11y (#2682)', () => {
  it('names the agent-type radiogroup from the section heading', () => {
    renderGeneralTab();
    expect(
      screen.getByRole('radiogroup', { name: 'Agent type' }),
    ).toBeInTheDocument();
  });
});
