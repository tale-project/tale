import { ThemeProvider } from '@tale/ui/theme';
import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import navJson from '@/content/nav.json';
import { checkAccessibility } from '@/tests/utils/a11y';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/');
});

const { HomePage } = await import('./home-page');
const { HomeShowcase } = await import('@/app/components/home/home-showcase');

function renderPage() {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <HomePage />
      </TooltipProvider>
    </ThemeProvider>,
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
  beforeEach(() => {
    // Motion is covered in the browser. jsdom has no viewport for scroll
    // reveals, so audit the complete static page rather than hidden content.
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      media: query,
      matches: query === '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('leads with one display heading and the route into the docs', () => {
    const { container } = renderPage();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(
      'React components. One shared language.',
    );
    expect(
      screen.getByRole('link', { name: 'Start building' }),
    ).toHaveAttribute('href', '/docs/getting-started/installation');
  });

  it('explains both packages and links to their component guides', () => {
    renderPage();
    const band = screen
      .getByRole('heading', { name: 'Two packages. One design system.' })
      .closest('section');
    expect(band).not.toBeNull();
    const packages = within(band as HTMLElement);
    expect(
      packages.getByRole('link', { name: /^Application interfaces/ }),
    ).toHaveAttribute('href', '/docs/components/button');
    expect(
      packages.getByRole('link', { name: /^Public websites/ }),
    ).toHaveAttribute('href', '/docs/marketing-ui/overview');
    expect(
      packages.getByText('@tale/ui', { selector: 'code' }),
    ).toBeInTheDocument();
    expect(
      packages.getByText('@tale/marketing-ui', { selector: 'code' }),
    ).toBeInTheDocument();
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
      .getByRole('heading', { name: 'Find your next building block.' })
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

  it('keeps local studio edits across keyboard tab changes and can reset them', async () => {
    const user = userEvent.setup();
    renderPage();
    const studio = within(
      screen.getByRole('region', { name: 'Component studio' }),
    );
    const name = studio.getByRole('textbox', { name: 'Workspace name' });
    await user.clear(name);
    expect(
      studio.getByRole('heading', { name: 'Your workspace' }),
    ).toBeVisible();
    await user.type(name, 'Design team');
    expect(studio.getByRole('heading', { name: 'Design team' })).toBeVisible();
    await user.click(studio.getByRole('switch', { name: 'Weekly digest' }));
    expect(studio.getByText('Digest off')).toBeVisible();

    await user.click(studio.getByRole('tab', { name: 'Application UI' }));
    await user.keyboard('{ArrowRight}');
    const marketingTab = studio.getByRole('tab', { name: 'Marketing UI' });
    expect(marketingTab).toHaveFocus();
    expect(marketingTab).toHaveAttribute('aria-selected', 'true');
    expect(
      studio.getByRole('link', { name: 'Explore the building blocks' }),
    ).toHaveAttribute('href', '/docs/marketing-ui/overview');
    await user.keyboard('{ArrowLeft}');
    expect(studio.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(
      'Design team',
    );
    expect(
      studio.getByRole('switch', { name: 'Weekly digest' }),
    ).not.toBeChecked();

    await user.click(studio.getByRole('button', { name: 'Reset preview' }));
    expect(studio.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(
      'Northwind Studio',
    );
    expect(studio.getByRole('switch', { name: 'Weekly digest' })).toBeChecked();
    expect(studio.getByText('Digest on')).toBeVisible();
  });

  it('renders a complete initial studio before JavaScript runs', () => {
    const markup = renderToString(
      <ThemeProvider>
        <TooltipProvider>
          <HomeShowcase />
        </TooltipProvider>
      </ThemeProvider>,
    );
    const server = document.createElement('div');
    server.innerHTML = markup;
    expect(server.querySelector('input')?.getAttribute('value')).toBe(
      'Northwind Studio',
    );
    expect(
      server.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(server.textContent).toContain('Digest on');
    const panel = server.querySelector(
      '[role="tabpanel"][data-state="active"]',
    );
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(panel?.closest('[inert], [aria-hidden="true"]')).toBeNull();
    expect(
      Array.from(server.querySelectorAll<HTMLElement>('[style]')).filter(
        // Radix uses an aria-hidden, transparent input to bubble switch changes.
        (element) =>
          element.style.opacity === '0' &&
          element.getAttribute('aria-hidden') !== 'true',
      ),
    ).toHaveLength(0);
  });

  it('includes the app dependency when selecting the marketing installation', async () => {
    const user = userEvent.setup();
    renderPage();
    const tabs = within(
      screen.getByRole('tablist', { name: 'Package to install' }),
    );
    await user.click(tabs.getByRole('tab', { name: '@tale/marketing-ui' }));
    const command = screen.getByText(/bun add .*dist\/marketing-ui/);
    expect(command).toHaveTextContent("'github:tale-project/tale#dist/ui'");
    expect(command).toHaveTextContent(
      "'github:tale-project/tale#dist/marketing-ui'",
    );
    expect(command).toHaveTextContent('react@19 react-dom@19 tailwindcss@4');
  });

  it('selects a mobile theme inline by keyboard before Escape closes navigation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getByRole('button', { name: 'Open navigation menu' }),
    );
    const dialog = screen.getByRole('dialog');
    const menu = within(dialog);
    const themes = within(
      menu.getByRole('radiogroup', { name: 'Switch theme' }),
    );
    const dark = themes.getByRole('radio', { name: 'Dark' });
    // The close control receives initial focus; the theme group is one tab
    // stop, with arrow keys selecting an option inside the drawer.
    for (let step = 0; step < 4; step += 1) await user.tab();
    expect(themes.getByRole('radio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(dark).toHaveAttribute('aria-checked', 'true'));
    expect(dark).toHaveFocus();
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(dialog).toBeVisible();
    expect(menu.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(themes.getByRole('radio', { name: 'System' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open navigation menu' }),
    ).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderPage();
    await checkAccessibility(container);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Marketing UI' }));
    await checkAccessibility(container);
  });
});
