import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { McpConnectSection } from './mcp-connect-section';

/**
 * The page that holds the MCP address starts with the way to connect a coding
 * agent, where agents may sign in and this person may connect one — and says
 * nothing about it elsewhere, where the address and the key are all there is.
 */

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('@/app/features/coding-agent/hooks/use-new-connection', () => ({
  useNewConnection: () => ({ state: 'waiting' }),
}));

const agentAccess = { connectAgents: true };

vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({ connectAgents: agentAccess.connectAgents }),
  }),
);

describe('McpConnectSection', () => {
  it('teaches the connection, with the commands, a first prompt and the guide', async () => {
    agentAccess.connectAgents = true;
    const { container } = render(<McpConnectSection organizationId="org-1" />);

    const section = screen.getByRole('region', {
      name: 'Connect a coding agent',
    });
    expect(
      within(section).getByText(/work in this organization through Tale's MCP/),
    ).toBeInTheDocument();
    // The commands for the agent in use, at this deployment's address.
    expect(
      within(section).getByText(
        'claude mcp add --transport http tale https://tale.example.com/api/v1/mcp',
      ),
    ).toBeVisible();
    expect(within(section).getByText('claude mcp login tale')).toBeVisible();
    expect(
      within(section).getByText('Waiting for your agent to sign in…'),
    ).toBeVisible();
    const guide = within(section).getByRole('link', { name: 'Setup guide' });
    expect(guide.getAttribute('href')).toMatch(
      /\/develop\/use-tale-from-your-editor$/,
    );
    expect(guide).toHaveAttribute('target', '_blank');
    await checkAccessibility(container);
  });

  it('says nothing where agents may not sign in or the person may not connect one', () => {
    agentAccess.connectAgents = false;
    const { container } = render(<McpConnectSection organizationId="org-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
