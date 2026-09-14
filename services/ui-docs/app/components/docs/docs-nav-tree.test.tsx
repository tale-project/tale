import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/docs/components/button');
});

const { DocsNavTree } = await import('./docs-nav-tree');

const ACTIVE_SLUG = 'components/button';

function renderTree(onNavigate?: () => void) {
  return render(
    <nav aria-label="Design system documentation">
      <DocsNavTree activeSlug={ACTIVE_SLUG} onNavigate={onNavigate} />
    </nav>,
  );
}

/**
 * The rail's tree is built from `content/nav.json` and the frontmatter
 * manifest, so it doubles as a check that the two agree: a row's label is the
 * page's real title, and its href is the page's real route.
 */
describe('DocsNavTree', () => {
  it('renders one section header per nav group, with translated labels', () => {
    renderTree();
    for (const label of [
      'Getting started',
      'Foundations',
      'Components',
      'Patterns',
      'Marketing UI',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('labels each row with the page title and links to its route', () => {
    renderTree();
    expect(screen.getByRole('link', { name: 'Button' })).toHaveAttribute(
      'href',
      '/docs/components/button',
    );
    expect(screen.getByRole('link', { name: 'Introduction' })).toHaveAttribute(
      'href',
      '/docs/getting-started/introduction',
    );
  });

  it('marks exactly one row as the current page', () => {
    const { container } = renderTree();
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/docs/components/button');
    expect(current[0]).toHaveTextContent('Button');
  });

  it('reports a chosen page so the drawer can close itself', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderTree(onNavigate);
    await user.click(screen.getByRole('link', { name: 'Colours' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderTree();
    // Every row lives in a list; the section labels are plain text, and the
    // rail's accessible name comes from the landmark around it.
    expect(within(container).getAllByRole('list').length).toBeGreaterThan(0);
    await checkAccessibility(container);
  });
});
