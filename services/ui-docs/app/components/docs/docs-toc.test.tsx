import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

import { DocsToc } from './docs-toc';

/**
 * The right rail. It is the page's second navigation affordance, so it has to
 * be a named landmark with real anchors — and it has to vanish entirely on a
 * page with no headings rather than leave an empty labelled region behind.
 */

const ENTRIES: TocEntry[] = [
  { id: 'variants', text: 'Variants', level: 2 },
  { id: 'sizes', text: 'Sizes', level: 3 },
  { id: 'accessibility', text: 'Accessibility', level: 2 },
];

describe('DocsToc', () => {
  it('renders the outline as a labelled complementary rail', () => {
    render(<DocsToc entries={ENTRIES} />);
    const rail = screen.getByRole('complementary', { name: 'On this page' });
    expect(within(rail).getAllByRole('link')).toHaveLength(3);
    expect(within(rail).getByRole('link', { name: 'Sizes' })).toHaveAttribute(
      'href',
      '#sizes',
    );
  });

  it('marks exactly one entry as current for scroll-spy', () => {
    const { container } = render(<DocsToc entries={ENTRIES} />);
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it('renders nothing when the page has no headings', () => {
    const { container } = render(<DocsToc entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<DocsToc entries={ENTRIES} />);
    await checkAccessibility(container);
  });
});

describe('outline motion preference', () => {
  it.each([false, true])(
    'uses the current reduced-motion preference: %s',
    (reduced) => {
      const matchMedia = vi
        .spyOn(window, 'matchMedia')
        .mockImplementation((query) => ({
          matches: reduced,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }));
      render(
        <>
          <DocsToc entries={ENTRIES} />
          <h2 id="sizes">Target section</h2>
        </>,
      );
      const target = screen.getByRole('heading', { name: 'Target section' });
      const scroll = vi.spyOn(target, 'scrollIntoView').mockClear();
      fireEvent.click(screen.getByRole('link', { name: 'Sizes' }));
      expect(scroll).toHaveBeenCalledWith({
        behavior: reduced ? 'instant' : 'smooth',
        block: 'start',
      });
      scroll.mockRestore();
      matchMedia.mockRestore();
    },
  );
});
