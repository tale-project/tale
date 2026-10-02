import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ACTIVE_HREF, SECTIONS } from './__fixtures__/docs-nav';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub(ACTIVE_HREF);
});

const { DocsNavTree } = await import('./docs-nav-tree');

function renderTree(onNavigate?: () => void) {
  return render(
    <nav aria-label="Documentation">
      <DocsNavTree
        sections={SECTIONS}
        activeHref={ACTIVE_HREF}
        onNavigate={onNavigate}
      />
    </nav>,
  );
}

describe('DocsNavTree', () => {
  it('renders the top-level groups as sub-panel sections', () => {
    renderTree();
    expect(screen.getByText('Start here')).toBeInTheDocument();
    expect(screen.getByText('Self-hosted')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Tale documentation' }),
    ).toHaveAttribute('href', '/');
  });

  it('marks exactly one row as the current page', () => {
    const { container } = renderTree();
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', ACTIVE_HREF);
    expect(current[0]).toHaveTextContent('Run your first self-hosted instance');
  });

  it('opens the group that holds the active page and toggles it', async () => {
    const { user } = renderTree();
    const disclosure = screen.getByRole('button', { name: 'Install' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a group without the active page closed', () => {
    renderTree();
    expect(
      screen.getByRole('button', { name: 'Configuration' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('reports a chosen page so the drawer can close itself', async () => {
    const onNavigate = vi.fn();
    const { user } = renderTree(onNavigate);
    await user.click(
      screen.getByRole('link', { name: 'Send your first message' }),
    );
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
