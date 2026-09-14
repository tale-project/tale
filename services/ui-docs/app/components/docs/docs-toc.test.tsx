import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
