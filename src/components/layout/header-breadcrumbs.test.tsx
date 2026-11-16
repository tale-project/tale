import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { HeaderBreadcrumbs } from './header-breadcrumbs';

describe('HeaderBreadcrumbs', () => {
  it('exposes an icon-only back button to the immediate parent on mobile', () => {
    render(
      <HeaderBreadcrumbs
        ariaLabel="Breadcrumb"
        crumbs={[
          { key: 'agents', content: <a href="/agents">Agents</a> },
          {
            key: 'folder',
            content: <a href="/agents?folder=github">github</a>,
          },
        ]}
        leaf="Reviewer"
      />,
    );

    // Regression: before the mobile fallback the parent links lived only in the
    // `hidden md:flex` trail, so a phone had no reachable way back. The back
    // control is now an icon-only link — its accessible name is "Back" (not the
    // parent's text label, which ate header width) and it points at the
    // immediate parent's own destination.
    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveClass('md:hidden');
    expect(back).toHaveAttribute('href', '/agents?folder=github');
    // A chevron glyph, and no leaked parent label text.
    expect(back.querySelector('svg')).toBeInTheDocument();
    expect(back).not.toHaveTextContent('github');
  });

  it('keeps all ancestor crumbs desktop-only by default', () => {
    render(
      <HeaderBreadcrumbs
        ariaLabel="Breadcrumb"
        crumbs={[
          { key: 'agents', content: <a href="/agents">Agents</a> },
          {
            key: 'folder',
            content: <a href="/agents?folder=github">github</a>,
          },
        ]}
        leaf="Reviewer"
      />,
    );

    for (const name of ['Agents', 'github'] as const) {
      const trailLink = screen.getByRole('link', { name });
      expect(trailLink.closest('li')).toHaveClass('hidden', 'md:flex');
    }
  });

  it('shows the immediate parent in the trail on mobile when opted in', () => {
    render(
      <HeaderBreadcrumbs
        ariaLabel="Breadcrumb"
        showImmediateParentOnMobile
        crumbs={[
          { key: 'agents', content: <a href="/agents">Agents</a> },
          {
            key: 'folder',
            content: <a href="/agents?folder=github">github</a>,
          },
        ]}
        leaf="Reviewer"
      />,
    );

    // Agent file-based detail: mobile title is `[parent] / [leaf]`. Only the
    // last ancestor stays visible below `md`; earlier crumbs stay desktop-only.
    const parentLink = screen.getByRole('link', { name: 'github' });
    expect(parentLink.closest('li')).toHaveClass('flex');
    expect(parentLink.closest('li')).not.toHaveClass('hidden');

    const agentsLink = screen.getByRole('link', { name: 'Agents' });
    expect(agentsLink.closest('li')).toHaveClass('hidden', 'md:flex');
  });

  it('keeps the full ancestor trail as text links on desktop', () => {
    render(
      <HeaderBreadcrumbs
        ariaLabel="Breadcrumb"
        crumbs={[
          { key: 'agents', content: <a href="/agents">Agents</a> },
          {
            key: 'folder',
            content: <a href="/agents?folder=github">github</a>,
          },
        ]}
        leaf="Reviewer"
      />,
    );

    // The desktop trail is untouched: each ancestor is a text link inside a
    // `hidden md:flex` item (the icon back-button owns the "Back" name, so the
    // only link named "github" is the trail one).
    const trailLink = screen.getByRole('link', { name: 'github' });
    expect(trailLink.closest('li')).toHaveClass('hidden', 'md:flex');
    expect(screen.getByRole('link', { name: 'Agents' })).toBeInTheDocument();
  });

  it('renders the current page as the sole h1 leaf', () => {
    render(
      <HeaderBreadcrumbs
        ariaLabel="Breadcrumb"
        crumbs={[
          {
            key: 'automations',
            content: <a href="/automations">Automations</a>,
          },
        ]}
        leaf="Notify members on inbound messages"
      />,
    );

    // One h1 only — the mobile/desktop copies duplicate the ancestor crumbs,
    // never the leaf.
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Notify members on inbound messages');
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <HeaderBreadcrumbs
        ariaLabel="Breadcrumb"
        crumbs={[
          {
            key: 'automations',
            content: <a href="/automations">Automations</a>,
          },
        ]}
        leaf="Notify members on inbound messages"
      />,
    );
    await checkAccessibility(container);
  });
});
