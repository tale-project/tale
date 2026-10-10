import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

import { CodingAgentButton } from './coding-agent-entry';

/**
 * An automation changes through a coding agent connected to Tale's MCP
 * server; the canvas only takes small field edits. The entry says so and
 * hands the reader what an agent needs: the automation's name, the way to
 * set up MCP and the guide.
 */
describe('CodingAgentButton', () => {
  it('opens the way to edit with a coding agent', async () => {
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
    // The name to hand the agent, copied with one press.
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
    await checkAccessibility(dialog);
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
