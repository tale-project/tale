import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { StickySectionHeader } from './sticky-section-header';

describe('StickySectionHeader', () => {
  describe('rendering', () => {
    it('renders title', () => {
      render(<StickySectionHeader title="Section Title" />);
      expect(
        screen.getByRole('heading', { name: 'Section Title' }),
      ).toBeInTheDocument();
    });

    it('renders description', () => {
      render(
        <StickySectionHeader title="Title" description="Some description" />,
      );
      expect(screen.getByText('Some description')).toBeInTheDocument();
    });

    it('renders action', () => {
      render(
        <StickySectionHeader
          title="Title"
          action={<button type="button">Save</button>}
        />,
      );
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <StickySectionHeader title="Title" className="extra" />,
      );
      expect(container.firstChild).toHaveClass('extra');
    });

    it('has sticky positioning', () => {
      const { container } = render(<StickySectionHeader title="Title" />);
      expect(container.firstChild).toHaveClass('sticky');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <StickySectionHeader
          title="Settings"
          description="Configure your settings"
          action={<button type="button">Save</button>}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
