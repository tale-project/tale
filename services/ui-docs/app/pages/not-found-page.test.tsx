import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/docs/gone');
});

const { NotFoundPage } = await import('./not-found-page');

/**
 * Most ways to land on the 404 are a stale link to a page that used to exist
 * under `/docs`, so the page owes a reader two things: a heading that says
 * what happened, and one route back into the documentation.
 */
describe('NotFoundPage', () => {
  it('says what happened in the page heading', () => {
    const { container } = render(<NotFoundPage />);
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Page not found');
  });

  it('offers one route back into the documentation', () => {
    render(<NotFoundPage />);
    expect(
      screen.getByRole('link', { name: 'Back to the introduction' }),
    ).toHaveAttribute('href', '/docs/getting-started/introduction');
  });

  it('sets a noindex document title', () => {
    render(<NotFoundPage />);
    expect(document.title).toBe('Page not found | The Tale design system');
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      expect.stringContaining('noindex'),
    );
  });

  it('renders the message inside the main landmark', () => {
    render(<NotFoundPage />);
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent(
      'That page is not part of the design system',
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<NotFoundPage />);
    await checkAccessibility(container);
  });
});
