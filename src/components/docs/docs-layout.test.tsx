import * as client from '@tale/ui/search/static-index/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ACTIVE_HREF, SECTIONS } from './__fixtures__/docs-nav';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub(ACTIVE_HREF);
});

const { DocsLayout } = await import('./docs-layout');

function renderLayout() {
  return render(
    <DocsLayout
      sections={SECTIONS}
      activeHref={ACTIVE_HREF}
      homeHref="/"
      homeLabel="Tale documentation home"
      navLabel="Documentation"
      search={{
        indexUrl: '/search-index-en.json',
        recentsStorageKey: 'tale.test.recentSearches.v1',
      }}
      footer={{
        legalLines: ['© 2026 Tale', 'Tale is MIT licensed.'],
        baseUrl: '/',
        repositoryUrl: 'https://github.com/tale-project/tale',
      }}
    >
      <p>Page body</p>
    </DocsLayout>,
  );
}

beforeEach(() => {
  vi.spyOn(client, 'loadIndex').mockResolvedValue(
    // oxlint-disable-next-line typescript/no-explicit-any -- the palette only awaits the index
    {} as any,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocsLayout', () => {
  it('starts with a skip link to the main landmark that holds the page', () => {
    renderLayout();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveAttribute('href', '#main');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(within(main).getByText('Page body')).toBeInTheDocument();
  });

  it('names the rail by the site and marks the page on screen', () => {
    renderLayout();
    const rail = screen.getByRole('navigation', { name: 'Documentation' });
    expect(
      within(rail).getByRole('link', { name: 'Tale documentation home' }),
    ).toHaveAttribute('href', '/');
    expect(rail.querySelector('[aria-current="page"]')).toHaveAttribute(
      'href',
      ACTIVE_HREF,
    );
  });

  it('closes the column with the footer: legal lines, indexes, repository', () => {
    renderLayout();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('© 2026 Tale')).toBeInTheDocument();
    expect(
      within(footer).getByRole('link', { name: 'llms.txt' }),
    ).toHaveAttribute('href', '/llms.txt');
    expect(
      within(footer).getByRole('link', { name: 'GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/tale-project/tale');
    expect(
      within(footer).getByRole('button', { name: 'Switch theme' }),
    ).toBeInTheDocument();
    expect(
      within(footer).queryByRole('button', { name: /Switch language/ }),
    ).toBeNull();
  });

  it('opens the search palette with Cmd/Ctrl+K', async () => {
    const { user } = renderLayout();
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(
      screen.getByPlaceholderText('Search documentation'),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderLayout();
    await checkAccessibility(container);
  });
});
