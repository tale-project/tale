import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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

    it('keeps the chevron on the first line of the summary', () => {
      const { container } = render(
        <CollapsibleDetails
          summary={
            <div>
              <p>Title</p>
              <p>Meta</p>
            </div>
          }
        >
          <p>Content</p>
        </CollapsibleDetails>,
      );
      const summary = container.querySelector('summary');
      expect(summary).toHaveClass('items-start');
      expect(summary).not.toHaveClass('items-center');
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
  describe('defaultOpen', () => {
    it('opens at mount', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details" defaultOpen>
          <p>Content</p>
        </CollapsibleDetails>,
      );
      expect(container.querySelector('details')).toHaveProperty('open', true);
    });

    it('stays closed without it', () => {
      const { container } = render(
        <CollapsibleDetails summary="Details">
          <p>Content</p>
        </CollapsibleDetails>,
      );
      expect(container.querySelector('details')).toHaveProperty('open', false);
    });

    it('leaves the reader’s toggle alone on a later render', () => {
      const { container, rerender } = render(
        <CollapsibleDetails summary="Details" defaultOpen>
          <p>Content</p>
        </CollapsibleDetails>,
      );
      const details = container.querySelector('details');
      if (details === null) throw new Error('no details element');
      details.open = false;
      rerender(
        <CollapsibleDetails summary="Details" defaultOpen>
          <p>Changed content</p>
        </CollapsibleDetails>,
      );
      expect(details.open).toBe(false);
    });

    it('is not passed to the DOM as an unknown attribute', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(
        <CollapsibleDetails summary="Details" defaultOpen>
          <p>Content</p>
        </CollapsibleDetails>,
      );
      expect(container.querySelector('details')).not.toHaveAttribute(
        'defaultopen',
      );
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
