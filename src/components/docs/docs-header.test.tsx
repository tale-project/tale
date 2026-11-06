import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/self-hosted/configuration/config-releases');
});

const { DocsHeader } = await import('./docs-header');

const CRUMBS = [
  { label: 'Home', href: '/' },
  { label: 'Self-hosted', href: '/self-hosted' },
  { label: 'Configuration' },
  { label: 'Publish client configurations' },
];

describe('DocsHeader', () => {
  it('renders the trail as a semantic nav > ol rooted at the front door', () => {
    render(<DocsHeader crumbs={CRUMBS} />);
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(trail).getByRole('list')).toBeInTheDocument();
    expect(within(trail).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      within(trail).getByRole('link', { name: 'Self-hosted' }),
    ).toHaveAttribute('href', '/self-hosted');
  });

  it('marks the leaf as the current page without making it a heading', () => {
    const { container } = render(<DocsHeader crumbs={CRUMBS} />);
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    const current = within(trail).getByText('Publish client configurations');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(container.querySelector('h1')).toBeNull();
    // A nav group with no page of its own stays text, never a dead link.
    expect(
      within(trail).queryByRole('link', { name: 'Configuration' }),
    ).toBeNull();
  });

  it('keeps a trail on a landing page, with the front door as the leaf', () => {
    render(<DocsHeader crumbs={[{ label: 'Home', href: '/' }]} />);
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(trail).getByText('Home')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(trail).queryByRole('link')).toBeNull();
  });

  it('renders page actions beside the trail', () => {
    render(
      <DocsHeader
        crumbs={CRUMBS}
        actions={<button type="button">Copy page</button>}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Copy page' }),
    ).toBeInTheDocument();
  });

  it('is one fixed-height bar from md up, border included', () => {
    render(
      <DocsHeader
        crumbs={CRUMBS}
        actions={<button type="button">Copy page</button>}
      />,
    );
    // The strip must be the `h-13` box itself: a bordered wrapper around a
    // fixed-height row ends a pixel below the rail's logo row. The real
    // geometry is asserted in `docs-layout.browser.test.tsx`.
    const strip = screen.getByRole('navigation', {
      name: 'Breadcrumbs',
    }).parentElement;
    expect(strip).toHaveClass('md:h-13', 'border-b');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DocsHeader
        crumbs={CRUMBS}
        actions={<button type="button">Copy page</button>}
      />,
    );
    await checkAccessibility(container);
  });
});
