import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

vi.mock('@tanstack/react-router', async () => {
  const { forwardRef } = await import('react');
  return {
    Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
      { to, params, children, ...rest },
      ref,
    ) {
      const href = Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to ?? '#',
      );
      return (
        <a ref={ref} href={href} {...rest}>
          {children}
        </a>
      );
    }),
  };
});

const h = vi.hoisted(() => ({
  access: { signInOn: true } as { signInOn: boolean } | undefined,
}));

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://tale.example.com',
}));
vi.mock('@/app/features/coding-agent/hooks/use-new-connection', () => ({
  useNewConnection: () => ({ state: 'waiting' }),
}));
vi.mock(
  '@/app/features/settings/agent-connections/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/agent-connections/hooks/queries')
    >()),
    useAgentConnectionAccess: () => ({ data: h.access }),
  }),
);

import {
  CodingAgentButton,
  CodingAgentDialog,
  FixRunButton,
} from './coding-agent-entry';

beforeEach(() => {
  h.access = { signInOn: true };
});

/**
 * An automation changes through a coding agent connected to Tale's MCP
 * server; the canvas only takes small field edits. The entry says so and
 * hands the reader what an agent needs: the commands that connect it, a
 * prompt that names this automation, and the guide.
 */
describe('CodingAgentButton', () => {
  it('opens the way to edit with a coding agent, with a prompt that names the automation', async () => {
    const { user } = render(
      <CodingAgentButton
        organizationId="org-1"
        automationSlug="support/triage-inbox"
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Edit with your coding agent',
    });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(button);

    const dialog = await screen.findByRole('dialog', {
      name: 'Edit with your coding agent',
    });
    expect(dialog).toHaveAccessibleDescription(
      /^Coding agents such as Claude Code, Codex and Cursor change automations through Tale's MCP server\./,
    );
    // The commands that connect the agent in use.
    expect(within(dialog).getByText('claude mcp login tale')).toBeVisible();
    // The prompt hands the agent this automation by name.
    expect(within(dialog).getByText(/support\/triage-inbox/)).toBeVisible();
    expect(
      within(dialog).getByText('[Describe the change you want.]'),
    ).toBeVisible();
    const guide = within(dialog).getByRole('link', { name: 'Setup guide' });
    expect(guide.getAttribute('href')).toMatch(
      /\/develop\/use-tale-from-your-editor$/,
    );
    expect(guide).toHaveAttribute('target', '_blank');
    await checkAccessibility(dialog);
  });

  it('offers the name to copy and the MCP settings while agents may not sign in', async () => {
    h.access = { signInOn: false };
    const { user } = render(
      <CodingAgentButton
        organizationId="org-1"
        automationSlug="support/triage-inbox"
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Edit with your coding agent' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Edit with your coding agent',
    });
    // The name to hand an agent that holds a key, copied with one press.
    expect(
      within(dialog).getByRole('button', {
        name: 'Name of this automation support/triage-inbox',
      }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('link', { name: 'Set up MCP' }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/api/mcp');
    const guide = within(dialog).getByRole('link', {
      name: 'How to connect a coding agent',
    });
    expect(guide.getAttribute('href')).toMatch(/\/develop\/mcp-endpoint$/);
    expect(guide).toHaveAttribute('target', '_blank');
    expect(
      within(dialog).queryByText('claude mcp login tale'),
    ).not.toBeInTheDocument();
    await checkAccessibility(dialog);
  });

  it('shows the guided setup while it is not yet known whether agents may sign in', async () => {
    h.access = undefined;
    const { user } = render(
      <CodingAgentButton
        organizationId="org-1"
        automationSlug="support/triage-inbox"
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Edit with your coding agent' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('claude mcp login tale')).toBeVisible();
  });

  it('is the main action of an empty automation', () => {
    render(
      <CodingAgentButton
        organizationId="org-1"
        automationSlug="support/triage-inbox"
        variant="primary"
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Edit with your coding agent',
    });
    // The label stays visible: on an empty canvas it is the one action.
    expect(
      within(button).getByText('Edit with your coding agent'),
    ).not.toHaveClass('sr-only');
  });
});

/**
 * A failed run goes to the same coding agent as an edit does, with a prompt
 * that names the run, so the agent starts from its record.
 */
describe('FixRunButton', () => {
  it('opens the way to fix a failed run, with a prompt that names the run and its automation', async () => {
    const { user } = render(
      <FixRunButton
        organizationId="org-1"
        automationSlug="support/triage-inbox"
        runId="run-9f3"
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Fix with your coding agent',
    });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(button);

    const dialog = await screen.findByRole('dialog', {
      name: 'Fix with your coding agent',
    });
    expect(dialog).toHaveAccessibleDescription(
      /^A coding agent connected to Tale's MCP server can read this run step by step/,
    );
    // The commands that connect the agent in use.
    expect(within(dialog).getByText('claude mcp login tale')).toBeVisible();
    // The prompt hands the agent this run and its automation.
    expect(
      within(dialog).getByText(
        /The run run-9f3 of the automation support\/triage-inbox failed\./,
      ),
    ).toBeVisible();
    // It asks for nothing to be filled in, so it says nothing about brackets.
    expect(
      within(dialog).queryByText(/Replace the part in brackets/),
    ).not.toBeInTheDocument();
    await checkAccessibility(dialog);
  });

  it('offers the name and the run to copy while agents may not sign in', async () => {
    h.access = { signInOn: false };
    const { user } = render(
      <FixRunButton
        organizationId="org-1"
        automationSlug="support/triage-inbox"
        runId="run-9f3"
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Fix with your coding agent' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Fix with your coding agent',
    });
    expect(
      within(dialog).getByRole('button', {
        name: 'Name of this automation support/triage-inbox',
      }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'ID of this run run-9f3' }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('link', { name: 'Set up MCP' }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/api/mcp');
    expect(
      within(dialog).queryByText('claude mcp login tale'),
    ).not.toBeInTheDocument();
    await checkAccessibility(dialog);
  });
});

/**
 * A new automation is built the same way a changed one is: by a coding agent,
 * so the list's Create menu opens the dialog too — with a prompt that asks
 * the agent to create one, and no automation to name yet.
 */
describe('CodingAgentDialog for a new automation', () => {
  function renderCreate() {
    return render(
      <CodingAgentDialog
        open
        onOpenChange={() => {}}
        organizationId="org-1"
        context={{ kind: 'create' }}
      />,
    );
  }

  it('asks the agent to create one, with a place for what it should do', async () => {
    renderCreate();
    const dialog = await screen.findByRole('dialog', {
      name: 'Create with your coding agent',
    });
    expect(dialog).toHaveAccessibleDescription(
      /^Coding agents such as Claude Code, Codex and Cursor build automations through Tale's MCP server\./,
    );
    // The commands that connect the agent in use.
    expect(within(dialog).getByText('claude mcp login tale')).toBeVisible();
    expect(within(dialog).getByText(/Create a new automation\./)).toBeVisible();
    expect(
      within(dialog).getByText('[Describe what it should do.]'),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/Replace the part in brackets/),
    ).toBeVisible();
    await checkAccessibility(dialog);
  });

  it('has no name to copy while agents may not sign in, only the way to the MCP settings', async () => {
    h.access = { signInOn: false };
    renderCreate();
    const dialog = await screen.findByRole('dialog', {
      name: 'Create with your coding agent',
    });
    expect(
      within(dialog).queryByRole('button', { name: /Name of this automation/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Set up MCP' }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/api/mcp');
    expect(
      within(dialog).getByRole('link', {
        name: 'How to connect a coding agent',
      }),
    ).toBeVisible();
    expect(
      within(dialog).queryByText('claude mcp login tale'),
    ).not.toBeInTheDocument();
    await checkAccessibility(dialog);
  });
});
