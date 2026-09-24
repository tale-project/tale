import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/docs/components/button');
});

const { DocsArticle } = await import('./docs-article');

const TOC: TocEntry[] = [
  { id: 'variants', text: 'Variants', level: 2 },
  { id: 'props', text: 'Props', level: 2 },
];

function renderArticle(
  overrides: Partial<Parameters<typeof DocsArticle>[0]> = {},
) {
  return render(
    <DocsArticle
      title="Button"
      description="Choose an action style."
      readingTimeMinutes={4}
      toc={TOC}
      prev={{ href: '/docs/foundations/accessibility', label: 'Accessibility' }}
      next={{ href: '/docs/components/input', label: 'Input' }}
      editHref="https://github.com/tale-project/tale/edit/main/button.md"
      {...overrides}
    >
      <h2 id="variants">Variants</h2>
      <h2 id="props">Props</h2>
    </DocsArticle>,
  );
}

describe('DocsArticle', () => {
  it('titles the page with its only h1, inside the article header', () => {
    const { container } = renderArticle();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Button');
    expect(container.querySelector('article > header > h1')).toBe(headings[0]);
  });

  it('reads the description and the reading metadata', () => {
    renderArticle({ updatedAt: '15 Sept 2026' });
    const article = screen.getByRole('article');
    expect(
      within(article).getByText('Choose an action style.'),
    ).toBeInTheDocument();
    expect(within(article).getByText('4 min read')).toBeInTheDocument();
    expect(
      within(article).getByText('Last updated 15 Sept 2026'),
    ).toBeInTheDocument();
  });

  it('renders the body, the neighbours and the edit link in reading order', () => {
    renderArticle();
    const article = screen.getByRole('article');
    expect(
      within(article).getByRole('heading', { level: 2, name: 'Variants' }),
    ).toBeInTheDocument();
    expect(
      within(article).getByRole('navigation', { name: 'Page navigation' }),
    ).toBeInTheDocument();
    const edit = within(article).getByRole('link', { name: 'Edit on GitHub' });
    expect(edit).toHaveAttribute(
      'href',
      'https://github.com/tale-project/tale/edit/main/button.md',
    );
    expect(edit).toHaveAttribute('target', '_blank');
    expect(edit).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides the edit link when the page has no source to edit', () => {
    renderArticle({ editHref: undefined });
    expect(screen.queryByRole('link', { name: 'Edit on GitHub' })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderArticle();
    await checkAccessibility(container);
  });
});
