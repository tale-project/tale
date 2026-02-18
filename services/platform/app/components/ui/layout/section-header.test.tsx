import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { SectionHeader } from './section-header';

describe('SectionHeader', () => {
  describe('rendering', () => {
    it('renders title as h2 by default', () => {
      render(<SectionHeader title="Section Title" />);
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Section Title',
      );
    });

    it('renders title as h3 when as="h3"', () => {
      render(<SectionHeader title="Section Title" as="h3" />);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'Section Title',
      );
    });

    it('renders title as h4 when as="h4"', () => {
      render(<SectionHeader title="Section Title" as="h4" />);
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent(
        'Section Title',
      );
    });

    it('renders description when provided', () => {
      render(
        <SectionHeader title="Title" description="A helpful description" />,
      );
      expect(screen.getByText('A helpful description')).toBeInTheDocument();
    });

    it('does not render description when not provided', () => {
      const { container } = render(<SectionHeader title="Title" />);
      expect(container.querySelector('p')).toBeNull();
    });

    it('renders action when provided', () => {
      render(
        <SectionHeader
          title="Title"
          action={<button type="button">Save</button>}
        />,
      );
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('renders ReactNode title', () => {
      render(
        <SectionHeader
          title={
            <>
              Title <span>badge</span>
            </>
          }
        />,
      );
      expect(screen.getByText('badge')).toBeInTheDocument();
    });
  });

  describe('variants', () => {
    it.each(['sm', 'base', 'lg'] as const)(
      'applies %s size variant',
      (size) => {
        render(<SectionHeader title="Title" size={size} />);
        expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
      },
    );

    it('applies medium weight variant', () => {
      render(<SectionHeader title="Title" weight="medium" />);
      expect(screen.getByRole('heading', { level: 2 }).className).toContain(
        'font-medium',
      );
    });

    it('applies semibold weight by default', () => {
      render(<SectionHeader title="Title" />);
      expect(screen.getByRole('heading', { level: 2 }).className).toContain(
        'font-semibold',
      );
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <SectionHeader title="Title" className="custom-class" />,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with title only', async () => {
      const { container } = render(<SectionHeader title="Title" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with title and description', async () => {
      const { container } = render(
        <SectionHeader title="Title" description="Description" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with action', async () => {
      const { container } = render(
        <SectionHeader
          title="Title"
          description="Description"
          action={<button type="button">Action</button>}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
