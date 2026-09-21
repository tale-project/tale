import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import navJson from '@/content/nav.json';
import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/');
});

const { HomePage } = await import('./home-page');

function renderPage() {
  return render(
    <TooltipProvider>
      <HomePage />
    </TooltipProvider>,
  );
}

/** Pages `content/nav.json` lists under one top-level group. */
function pagesInGroup(label: string): number {
  return (
    navJson.groups.find((group) => group.label === label)?.pages.length ?? 0
  );
}

const TOTAL_PAGES = navJson.groups.reduce(
  (total, group) => total + group.pages.length,
  0,
);

/**
 * The front page is the marketing language's own shop window, so what it
 * claims about the documentation has to come from the documentation: the
 * counts are read from the tree the rail renders, never typed into the page.
 */
describe('HomePage', () => {
  it('leads with one display heading and the route into the docs', () => {
    const { container } = renderPage();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('The Tale design system');
    expect(screen.getByRole('link', { name: 'Read the docs' })).toHaveAttribute(
      'href',
      '/docs/getting-started/introduction',
    );
  });

  it('counts the guides the navigation actually lists', () => {
    renderPage();
    expect(
      screen.getByText(new RegExp(`^${TOTAL_PAGES} guides ·`)),
    ).toBeInTheDocument();
  });

  it('sends each section card to its first page, stating how much it holds', () => {
    renderPage();
    // Scoped to the band: the header nav and both call-to-action pairs link
    // to some of the same pages, so a page-wide role query is ambiguous.
    const band = screen
      .getByRole('heading', { name: 'Where to go next' })
      .closest('section');
    expect(band).not.toBeNull();
    const cards = within(band as HTMLElement);
    const sections = [
      {
        name: 'Getting started',
        href: '/docs/getting-started/introduction',
        label: 'gettingStarted',
      },
      {
        name: 'Foundations',
        href: '/docs/foundations/colors',
        label: 'foundations',
      },
      {
        name: 'Components',
        href: '/docs/components/button',
        label: 'components',
      },
      { name: 'Patterns', href: '/docs/patterns/list-page', label: 'patterns' },
      {
        name: 'Marketing UI',
        href: '/docs/marketing-ui/overview',
        label: 'marketingUi',
      },
    ];
    for (const section of sections) {
      // No word boundary: jsdom's accessible name joins the card's spans
      // without whitespace ("ComponentsChoose component states…").
      const card = cards.getByRole('link', {
        name: new RegExp(`^${section.name}`),
      });
      expect(card).toHaveAttribute('href', section.href);
      const count = pagesInGroup(section.label);
      expect(
        within(card).getByText(count === 1 ? '1 guide' : `${count} guides`),
      ).toBeInTheDocument();
    }
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    await checkAccessibility(container);
  });
});
