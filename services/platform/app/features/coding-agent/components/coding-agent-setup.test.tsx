// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

const h = vi.hoisted(() => ({
  watch: { state: 'waiting' } as
    | { state: 'waiting' }
    | { state: 'connected'; clientName: string },
}));

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('../hooks/use-new-connection', () => ({
  useNewConnection: () => h.watch,
}));

import { CodingAgentSetup } from './coding-agent-setup';

beforeEach(() => {
  h.watch = { state: 'waiting' };
});
afterEach(() => vi.restoreAllMocks());

function renderSetup(
  ui: ReactNode = (
    <CodingAgentSetup
      organizationId="org-1"
      promptContext={{ kind: 'general' }}
    />
  ),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('CodingAgentSetup', () => {
  it('offers the coding agents as tabs, Claude Code first', () => {
    renderSetup();
    const tabs = screen.getByRole('tablist', { name: 'Coding agent' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Claude Code', 'Codex', 'Other']);
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the commands of Claude Code with the deployment’s own address', () => {
    renderSetup();
    expect(
      screen.getByText(
        'claude mcp add --transport http tale https://tale.example.com/api/v1/mcp',
      ),
    ).toBeVisible();
    expect(screen.getByText('claude mcp login tale')).toBeVisible();
    expect(
      screen.getByText(
        /^Add Tale to Claude Code\. Run this in your terminal\./,
      ),
    ).toBeVisible();
  });

  it('switches to the commands of Codex, and shows no other agent’s', async () => {
    const { user } = renderSetup();
    await user.click(screen.getByRole('tab', { name: 'Codex' }));
    expect(
      screen.getByText(
        'codex mcp add tale --url https://tale.example.com/api/v1/mcp',
      ),
    ).toBeVisible();
    // One command: Codex signs in as it adds the server.
    expect(screen.queryByText(/codex mcp login/)).not.toBeInTheDocument();
    expect(screen.queryByText(/claude mcp/)).not.toBeInTheDocument();
  });

  it('gives any other agent the address and says how to sign in', async () => {
    const { user } = renderSetup();
    await user.click(screen.getByRole('tab', { name: 'Other' }));
    expect(
      screen.getByText('https://tale.example.com/api/v1/mcp'),
    ).toBeVisible();
    expect(screen.getByText(/Choose browser sign-in \(OAuth\)/)).toBeVisible();
    expect(screen.queryByText(/mcp add/)).not.toBeInTheDocument();
  });

  it('copies exactly the command shown, and says so once', async () => {
    const { user } = renderSetup();
    const [first] = screen.getAllByRole('button', { name: 'Copy command' });
    await user.click(first);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      'claude mcp add --transport http tale https://tale.example.com/api/v1/mcp',
    );
  });

  it('says nothing about a place to fill in when the prompt has none', () => {
    renderSetup();
    expect(
      screen.queryByText('Replace the part in brackets before you send it.'),
    ).not.toBeInTheDocument();
  });

  it('says it is waiting for an agent to sign in, until one has', () => {
    renderSetup();
    expect(
      screen.getByText('Waiting for your agent to sign in…'),
    ).toBeVisible();
    expect(screen.queryByText(/^Connected:/)).not.toBeInTheDocument();
    expect(screen.getByText('Then ask your agent')).toBeVisible();
  });

  it('names the agent that signed in, and points to the prompt to try first', () => {
    h.watch = { state: 'connected', clientName: 'Codex' };
    renderSetup();
    expect(screen.getByText('Connected: Codex')).toBeVisible();
    expect(
      screen.queryByText('Waiting for your agent to sign in…'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Try this first')).toBeVisible();
  });

  it('shows the prompt for what is being asked, with the place to fill in marked', async () => {
    const { user } = renderSetup(
      <CodingAgentSetup
        organizationId="org-1"
        promptContext={{ kind: 'edit', name: 'weekly-report' }}
      />,
    );
    expect(screen.getByText(/weekly-report/)).toBeVisible();
    const mark = screen.getByText('[Describe the change you want.]');
    expect(mark.tagName).toBe('MARK');
    await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
    const copied = await waitFor(async () => {
      const text = await navigator.clipboard.readText();
      expect(text).not.toBe('');
      return text;
    });
    // The brackets are copied too: they are the part to replace.
    expect(copied).toContain('weekly-report');
    expect(copied).toContain('[Describe the change you want.]');
    expect(
      screen.getByText('Replace the part in brackets before you send it.'),
    ).toBeVisible();
  });

  it('passes an accessibility audit, waiting and connected', async () => {
    const { container, unmount } = renderSetup();
    await checkAccessibility(container);
    unmount();
    h.watch = { state: 'connected', clientName: 'Claude Code' };
    const connected = renderSetup();
    await checkAccessibility(connected.container);
  });
});
