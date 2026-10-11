import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { DocsToc, DocsTocOutline } from './docs-toc';

const ENTRIES: TocEntry[] = [
  { id: 'before-you-begin', text: 'Before you begin', level: 2 },
  { id: 'install-the-cli', text: 'Install the CLI', level: 3 },
  { id: 'troubleshooting', text: 'Troubleshooting', level: 2 },
];

/**
 * Both copies of the outline ship in the markup; the one the stylesheet hides
 * is `aria-hidden`, so a role query only ever finds the live one. jsdom has no
 * `matchMedia`, so each suite pins the width its copy belongs to.
 */
function mockRailWidth(isRail: boolean, reducedMotion = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : isRail,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DocsToc', () => {
  it('renders the outline as a labelled complementary rail', () => {
    mockRailWidth(true);
    render(<DocsToc entries={ENTRIES} />);
    const rail = screen.getByRole('complementary', { name: 'On this page' });
    expect(within(rail).getAllByRole('link')).toHaveLength(3);
    expect(
      within(rail).getByRole('link', { name: 'Install the CLI' }),
    ).toHaveAttribute('href', '#install-the-cli');
  });

  it.each([true, false])(
    'honors reduced motion (%s) when jumping to a heading',
    async (reducedMotion) => {
      mockRailWidth(true, reducedMotion);
      const scroll = vi.fn();
      const { user } = render(
        <>
          <h2 id="before-you-begin">Section target</h2>
          <DocsToc entries={ENTRIES} />
        </>,
      );
      const heading = screen.getByRole('heading', { name: 'Section target' });
      heading.scrollIntoView = scroll;
      await user.click(screen.getByRole('link', { name: 'Before you begin' }));
      expect(scroll).toHaveBeenCalledWith({
        behavior: reducedMotion ? 'instant' : 'smooth',
        block: 'start',
      });
    },
  );

  it('marks exactly one entry as current for scroll-spy', () => {
    mockRailWidth(true);
    render(<DocsToc entries={ENTRIES} />);
    const rail = screen.getByRole('complementary', { name: 'On this page' });
    expect(rail.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it('renders nothing when the page has no headings', () => {
    render(<DocsToc entries={[]} />);
    expect(
      screen.queryByRole('complementary', { name: 'On this page' }),
    ).toBeNull();
  });

  it('has no accessibility violations', async () => {
    mockRailWidth(true);
    const { container } = render(<DocsToc entries={ENTRIES} />);
    await checkAccessibility(container);
  });
});

describe('DocsTocOutline', () => {
  it('renders the same outline as a collapsed disclosure', () => {
    mockRailWidth(false);
    const { container } = render(<DocsTocOutline entries={ENTRIES} />);
    const outline = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(outline).getAllByRole('link')).toHaveLength(3);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('renders nothing when the page has no headings', () => {
    render(<DocsTocOutline entries={[]} />);
    expect(
      screen.queryByRole('navigation', { name: 'On this page' }),
    ).toBeNull();
  });

  it('has no accessibility violations', async () => {
    mockRailWidth(false);
    const { container } = render(<DocsTocOutline entries={ENTRIES} />);
    await checkAccessibility(container);
  });
});
