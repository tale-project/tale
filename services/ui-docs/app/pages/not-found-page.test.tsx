import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/docs/components/buton');
});

const { NotFoundPage } = await import('./not-found-page');

function renderPage() {
  // The docs frame's icon buttons carry tooltips, which need their provider;
  // the app gets it from `AppShell`.
  return render(
    <TooltipProvider>
      <NotFoundPage />
    </TooltipProvider>,
  );
}

/**
 * Most ways to land on the 404 are a stale link to a page that used to exist
 * under `/docs`, so the page owes a reader three things: a heading that says
 * what happened, the pages closest to the one they asked for, and one route
 * back into the documentation — all inside the same frame as every page.
 */
describe('NotFoundPage', () => {
  it('says what happened in the page heading', () => {
    const { container } = renderPage();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Page not found');
  });

  it('suggests the closest page first and one route back', () => {
    renderPage();
    const suggestions = screen.getByRole('navigation', {
      name: 'Did you mean',
    });
    expect(within(suggestions).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/docs/components/button',
    );
    expect(
      screen.getByRole('link', { name: 'Back to docs home' }),
    ).toHaveAttribute('href', '/docs/getting-started/introduction');
  });

  it('keeps the documentation rail beside the message', () => {
    renderPage();
    expect(
      screen.getByRole('navigation', { name: 'Design system documentation' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('heading', { level: 1 }),
    ).toBeInTheDocument();
  });

  it('sets a noindex document title', () => {
    renderPage();
    expect(document.title).toBe('Page not found | The Tale design system');
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      expect.stringContaining('noindex'),
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    await checkAccessibility(container);
  });
});
