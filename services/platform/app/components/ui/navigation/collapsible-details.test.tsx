import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { CollapsibleDetails } from './collapsible-details';

describe('CollapsibleDetails', () => {
  describe('rendering', () => {
    it('renders summary text', () => {
      render(
        <CollapsibleDetails summary="Details">
          <p>Hidden content</p>
        </CollapsibleDetails>,
      );
      expect(screen.getByText('Details')).toBeInTheDocument();
    });

    it('renders children', () => {
      render(
        <CollapsibleDetails summary="Details">
          <p>Expanded content</p>
        </CollapsibleDetails>,
      );
      expect(screen.getByText('Expanded content')).toBeInTheDocument();
    });

    it('renders chevron icon', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details">
          <p>Content</p>
        </CollapsibleDetails>,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details" className="custom-class">
          <p>Content</p>
        </CollapsibleDetails>,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('compact variant', () => {
    it('applies muted text color in compact variant', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details" variant="compact">
          <p>Content</p>
        </CollapsibleDetails>,
      );
      const summary = container.querySelector('summary');
      expect(summary).toHaveClass('text-muted-foreground');
    });

    it('applies smaller text size in compact variant', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details" variant="compact">
          <p>Content</p>
        </CollapsibleDetails>,
      );
      const summary = container.querySelector('summary');
      expect(summary).toHaveClass('text-xs');
    });

    it('applies default text size in default variant', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details" variant="default">
          <p>Content</p>
        </CollapsibleDetails>,
      );
      const summary = container.querySelector('summary');
      expect(summary).toHaveClass('text-sm');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CollapsibleDetails summary="More details">
          <p>Additional information</p>
        </CollapsibleDetails>,
      );
      await checkAccessibility(container);
    });
  });
});
