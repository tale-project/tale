import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { PageSection } from './page-section';

describe('PageSection', () => {
  describe('rendering', () => {
    it('renders as a section element', () => {
      const { container } = render(
        <PageSection title="Title">Content</PageSection>,
      );
      expect(container.querySelector('section')).toBeInTheDocument();
    });

    it('renders title heading', () => {
      render(<PageSection title="Settings">Content</PageSection>);
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Settings',
      );
    });

    it('renders children', () => {
      render(
        <PageSection title="Title">
          <p>Child content</p>
        </PageSection>,
      );
      expect(screen.getByText('Child content')).toBeInTheDocument();
    });

    it('renders description', () => {
      render(
        <PageSection title="Title" description="A description">
          Content
        </PageSection>,
      );
      expect(screen.getByText('A description')).toBeInTheDocument();
    });

    it('passes heading level through', () => {
      render(
        <PageSection title="Title" as="h3">
          Content
        </PageSection>,
      );
      expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    });

    it('renders action in header', () => {
      render(
        <PageSection
          title="Title"
          action={<button type="button">Action</button>}
        >
          Content
        </PageSection>,
      );
      expect(
        screen.getByRole('button', { name: 'Action' }),
      ).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      const { container } = render(
        <PageSection title="Title" className="custom-class">
          Content
        </PageSection>,
      );
      expect(container.querySelector('section')).toHaveClass('custom-class');
    });

    it('applies gap variant', () => {
      const { container } = render(
        <PageSection title="Title" gap={6}>
          Content
        </PageSection>,
      );
      expect(container.querySelector('section')).toHaveClass('gap-6');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <PageSection title="Title" description="Description">
          <p>Content</p>
        </PageSection>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with action', async () => {
      const { container } = render(
        <PageSection title="Title" action={<button type="button">Save</button>}>
          <p>Content</p>
        </PageSection>,
      );
      await checkAccessibility(container);
    });
  });
});
