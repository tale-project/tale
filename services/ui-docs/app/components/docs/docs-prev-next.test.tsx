import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/docs/components/data-table');
});

const { DocsPrevNext } = await import('./docs-prev-next');

/**
 * The reading path. Both neighbours come from nav order, and each card's
 * accessible name has to say which direction it goes — "Input" alone tells a
 * screen-reader user nothing about whether it is back or forward.
 */
describe('DocsPrevNext', () => {
  it('links both neighbours from a labelled nav', () => {
    render(
      <DocsPrevNext prevSlug="components/input" nextSlug="components/dialog" />,
    );
    const pagination = screen.getByRole('navigation', {
      name: 'Page navigation',
    });
    expect(
      within(pagination).getByRole('link', { name: 'Previous: Input' }),
    ).toHaveAttribute('href', '/docs/components/input');
    expect(
      within(pagination).getByRole('link', { name: 'Next: Dialog' }),
    ).toHaveAttribute('href', '/docs/components/dialog');
  });

  it('renders one card at the ends of the reading path', () => {
    const { rerender } = render(
      <DocsPrevNext prevSlug={null} nextSlug="components/input" />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Next: Input' }),
    ).toBeInTheDocument();

    rerender(<DocsPrevNext prevSlug="patterns/list-page" nextSlug={null} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Previous: List page' }),
    ).toBeInTheDocument();
  });

  it('renders nothing when the page has no neighbours', () => {
    const { container } = render(
      <DocsPrevNext prevSlug={null} nextSlug={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DocsPrevNext prevSlug="components/input" nextSlug="components/dialog" />,
    );
    await checkAccessibility(container);
  });
});
