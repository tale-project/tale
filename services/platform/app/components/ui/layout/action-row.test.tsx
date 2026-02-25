import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { ActionRow } from './action-row';

describe('ActionRow', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(
        <ActionRow>
          <button type="button">Action</button>
        </ActionRow>,
      );
      expect(
        screen.getByRole('button', { name: 'Action' }),
      ).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <ActionRow className="custom-class">
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('justify variant', () => {
    it('applies justify-start when justify is start', () => {
      const { container } = render(
        <ActionRow justify="start">
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('justify-start');
    });

    it('applies justify-end when justify is end', () => {
      const { container } = render(
        <ActionRow justify="end">
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('justify-end');
    });

    it('applies justify-between when justify is between', () => {
      const { container } = render(
        <ActionRow justify="between">
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('justify-between');
    });

    it('defaults to justify-start', () => {
      const { container } = render(
        <ActionRow>
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('justify-start');
    });
  });

  describe('gap variant', () => {
    it('applies gap-1 when gap is 1', () => {
      const { container } = render(
        <ActionRow gap={1}>
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('gap-1');
    });

    it('applies gap-2 when gap is 2', () => {
      const { container } = render(
        <ActionRow gap={2}>
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('gap-2');
    });

    it('applies gap-3 when gap is 3', () => {
      const { container } = render(
        <ActionRow gap={3}>
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('gap-3');
    });

    it('defaults to gap-2', () => {
      const { container } = render(
        <ActionRow>
          <span>Content</span>
        </ActionRow>,
      );
      expect(container.firstChild).toHaveClass('gap-2');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ActionRow>
          <button type="button">Save</button>
          <button type="button">Cancel</button>
        </ActionRow>,
      );
      await checkAccessibility(container);
    });
  });
});
