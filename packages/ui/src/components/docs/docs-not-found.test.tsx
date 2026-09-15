import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/platform/chat/basic');
});

const { DocsNotFound } = await import('./docs-not-found');

const HOME = { href: '/', label: 'Home' };
const SUGGESTIONS = [
  { href: '/platform/chat/basics', label: 'Platform / Chat / Basics' },
  { href: '/platform/chat/arena-mode', label: 'Platform / Chat / Arena Mode' },
];

describe('DocsNotFound', () => {
  it('says what happened in the page heading and the trail', () => {
    const { container } = render(
      <DocsNotFound home={HOME} suggestions={SUGGESTIONS} />,
    );
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Page not found');
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(trail).getByText('Page not found')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers the closest pages and one route back to the front door', () => {
    render(<DocsNotFound home={HOME} suggestions={SUGGESTIONS} />);
    const suggestions = screen.getByRole('navigation', {
      name: 'Did you mean',
    });
    expect(within(suggestions).getAllByRole('link')).toHaveLength(2);
    expect(
      within(suggestions).getByRole('link', {
        name: 'Platform / Chat / Basics',
      }),
    ).toHaveAttribute('href', '/platform/chat/basics');
    expect(
      screen.getByRole('link', { name: 'Back to docs home' }),
    ).toHaveAttribute('href', '/');
  });

  it('skips the suggestion list when nothing is close', () => {
    render(<DocsNotFound home={HOME} suggestions={[]} />);
    expect(
      screen.queryByRole('navigation', { name: 'Did you mean' }),
    ).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DocsNotFound home={HOME} suggestions={SUGGESTIONS} />,
    );
    await checkAccessibility(container);
  });
});
