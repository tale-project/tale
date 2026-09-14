import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TALE_REPO_URL } from '@/lib/site-url';
import { checkAccessibility } from '@/tests/utils/a11y';

import { DocsHeader } from './docs-header';

/**
 * The article's header strip. Its contract is small but load-bearing: the
 * trail is a labelled `nav`, the page's single `h1` is the trail's leaf (so a
 * screen reader's heading list matches the reader's position), and every
 * icon-only control in it carries a name.
 */

const CRUMBS = [{ key: 'Components', content: 'Components' }];

function renderHeader(onOpenSearch = vi.fn()) {
  return {
    onOpenSearch,
    ...render(
      <DocsHeader crumbs={CRUMBS} title="Button" onOpenSearch={onOpenSearch} />,
    ),
  };
}

describe('DocsHeader', () => {
  it('renders the trail as a labelled nav rooted at the section', () => {
    renderHeader();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(trail).getByRole('list')).toBeInTheDocument();
    expect(within(trail).getByText('Components')).toBeInTheDocument();
  });

  it('makes the page title the only h1, marked as the current page', () => {
    const { container } = renderHeader();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Button');
    expect(headings[0]).toHaveAttribute('aria-current', 'page');
  });

  it('gives the repository link an accessible name', () => {
    renderHeader();
    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('href', TALE_REPO_URL);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('carries the search trigger and the theme switcher', async () => {
    const user = userEvent.setup();
    const { onOpenSearch } = renderHeader();
    expect(
      screen.getByRole('button', { name: 'Switch theme' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open search' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderHeader();
    await checkAccessibility(container);
  });
});
