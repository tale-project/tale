// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('../hooks/use-new-connection', () => ({
  useNewConnection: () => ({ state: 'waiting' }),
}));

import { ConnectAgentDialog } from './connect-agent-dialog';

function renderDialog(open: boolean, onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    onOpenChange,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ConnectAgentDialog
          organizationId="org-1"
          open={open}
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ConnectAgentDialog', () => {
  it('is not there until it is opened', () => {
    renderDialog(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('teaches the connection: what the agent will do, the commands, the guide', () => {
    renderDialog(true);
    const dialog = screen.getByRole('dialog', {
      name: 'Connect a coding agent',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Your agent signs in with your Tale account. You choose the organization and what it may do.',
    );
    expect(screen.getByText('claude mcp login tale')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Setup guide' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/develop\/use-tale-from-your-editor$/),
    );
  });

  it('closes from Done', async () => {
    const { user, onOpenChange } = renderDialog(true);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes an accessibility audit', async () => {
    renderDialog(true);
    await checkAccessibility(
      screen.getByRole('dialog', { name: 'Connect a coding agent' }),
    );
  });
});
