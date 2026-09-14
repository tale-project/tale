import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

const pathname = '/self-hosted/install/quickstart';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname } }),
}));

const { DocsNavTree } = await import('./docs-nav-tree');

function renderTree(onNavigate?: () => void) {
  return render(
    <nav aria-label="Documentation">
      <DocsNavTree
        locale="en"
        activeSlug="self-hosted/install/quickstart"
        onNavigate={onNavigate}
      />
    </nav>,
  );
}

describe('DocsNavTree', () => {
  it('renders the nav.json groups as sub-panel sections', () => {
    renderTree();
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(screen.getByText('Self-hosted', { selector: 'div' })).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Tale documentation' }),
    ).toHaveAttribute('href', '/');
  });

  it('marks the active page row', () => {
    renderTree();
    const active = screen.getByRole('link', { name: 'Self-hosted quickstart' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('href', pathname);
  });

  it('opens the group that holds the active page and toggles it', async () => {
    const user = userEvent.setup();
    renderTree();
    const disclosure = screen.getByRole('button', { name: 'Install' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  });

  it('reports a chosen page so the drawer can close itself', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderTree(onNavigate);
    await user.click(screen.getByRole('link', { name: 'Quickstart' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderTree();
    // Every row lives in a list, and the section labels are plain text — the
    // rail's accessible name comes from the landmark, not a heading.
    expect(within(container).getAllByRole('list').length).toBeGreaterThan(0);
    await checkAccessibility(container);
  });
});
