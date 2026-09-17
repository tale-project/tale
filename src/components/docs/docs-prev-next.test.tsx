import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/docs/components/data-table');
});

const { DocsPrevNext } = await import('./docs-prev-next');

const INPUT = { href: '/docs/components/input', label: 'Input' };
const DIALOG = { href: '/docs/components/dialog', label: 'Dialog' };

/**
 * The reading path. Both neighbours come from nav order, and each card's
 * accessible name has to say which direction it goes — "Input" alone tells a
 * screen-reader user nothing about whether it is back or forward.
 */
describe('DocsPrevNext', () => {
  it('links both neighbours from a labelled nav, direction in the name', () => {
    render(<DocsPrevNext prev={INPUT} next={DIALOG} />);
    const pagination = screen.getByRole('navigation', {
      name: 'Page navigation',
    });
    expect(
      within(pagination).getByRole('link', { name: 'Previous: Input' }),
    ).toHaveAttribute('href', INPUT.href);
    expect(
      within(pagination).getByRole('link', { name: 'Next: Dialog' }),
    ).toHaveAttribute('href', DIALOG.href);
  });

  it('renders one card at the ends of the reading path', () => {
    const { rerender } = render(<DocsPrevNext prev={null} next={INPUT} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Next: Input' }),
    ).toBeInTheDocument();

    rerender(<DocsPrevNext prev={DIALOG} next={null} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Previous: Dialog' }),
    ).toBeInTheDocument();
  });

  it('renders nothing when the page has no neighbours', () => {
    render(<DocsPrevNext prev={null} next={null} />);
    expect(
      screen.queryByRole('navigation', { name: 'Page navigation' }),
    ).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<DocsPrevNext prev={INPUT} next={DIALOG} />);
    await checkAccessibility(container);
  });
});
