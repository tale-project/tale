import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    activeOptions: _activeOptions,
    ...rest
  }: {
    to: string;
    children: ReactNode;
    activeOptions?: unknown;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: '/' } }),
}));

const { DocsPageHeader } = await import('./docs-page-header');

const CRUMBS = [
  { label: 'Self-hosted', slug: 'self-hosted' },
  { label: 'Configuration' },
  { label: 'Publish client configurations' },
];

describe('DocsPageHeader', () => {
  it('renders the trail as a semantic nav > ol rooted at the docs home', () => {
    render(<DocsPageHeader locale="en" crumbs={CRUMBS} />);
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
    const { container } = render(
      <DocsPageHeader locale="en" crumbs={CRUMBS} />,
    );
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    const current = within(trail).getByText('Publish client configurations');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(container.querySelector('h1')).toBeNull();
    // A nav group with no page of its own stays text, never a dead link.
    expect(
      within(trail).queryByRole('link', { name: 'Configuration' }),
    ).toBeNull();
  });

  it('keeps a trail on a locale landing page, with home as the leaf', () => {
    render(<DocsPageHeader locale="fr" crumbs={[]} />);
    const trail = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    const current = within(trail).getByText('Home');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(trail).queryByRole('link')).toBeNull();
  });

  it('renders page actions beside the trail', () => {
    render(
      <DocsPageHeader
        locale="en"
        crumbs={CRUMBS}
        actions={<button type="button">Copy page</button>}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Copy page' }),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DocsPageHeader
        locale="en"
        crumbs={CRUMBS}
        actions={<button type="button">Copy page</button>}
      />,
    );
    await checkAccessibility(container);
  });
});
