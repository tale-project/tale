import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

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
function mockRailWidth(isRail: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isRail,
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

  it('renders nothing when the page has no headings', () => {
    const { container } = render(<DocsToc entries={[]} />);
    expect(container).toBeEmptyDOMElement();
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
    const { container } = render(<DocsTocOutline entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations', async () => {
    mockRailWidth(false);
    const { container } = render(<DocsTocOutline entries={ENTRIES} />);
    await checkAccessibility(container);
  });
});
