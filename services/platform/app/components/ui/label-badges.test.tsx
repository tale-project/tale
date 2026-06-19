import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { LabelBadges } from './label-badges';

describe('LabelBadges', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <LabelBadges labels={['Sales', 'Outreach', 'Email']} />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders nothing when there are no labels', () => {
    const { container } = render(<LabelBadges labels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the first label as a badge and no overflow when only one', () => {
    render(<LabelBadges labels={['Sales']} />);
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });

  it('shows the first label plus an overflow badge for the rest', () => {
    render(<LabelBadges labels={['Sales', 'Outreach', 'Email']} />);
    expect(screen.getByText('Sales')).toBeInTheDocument();
    // The remaining labels collapse into a single "…" overflow badge whose
    // tooltip carries them comma-separated.
    expect(screen.getByText('…')).toBeInTheDocument();
    expect(screen.queryByText('Outreach')).not.toBeInTheDocument();
  });
});
