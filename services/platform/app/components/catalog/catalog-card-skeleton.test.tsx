// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  CatalogCardSkeleton,
  CatalogGridSkeleton,
} from './catalog-card-skeleton';

describe('CatalogCardSkeleton', () => {
  it('is decorative — the enclosing Skeletonize owns the one status announcement', () => {
    render(
      <Skeletonize loading label="Catalog">
        <CatalogGridSkeleton />
      </Skeletonize>,
    );
    // Exactly one live region, from the wrapper — the placeholder cards
    // themselves announce nothing.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Catalog');
  });

  it('renders the shared 40px icon tile per placeholder card', () => {
    const { container } = render(
      <Skeletonize loading label="Catalog">
        <CatalogGridSkeleton />
      </Skeletonize>,
    );
    // Six placeholder cards by default — one size-10 media tile each.
    expect(container.getElementsByClassName('size-10')).toHaveLength(6);
  });

  it('honours the cards count and the optional footer bar', () => {
    const { container } = render(
      <Skeletonize loading label="Catalog">
        <CatalogGridSkeleton cards={3} footer />
      </Skeletonize>,
    );
    expect(container.getElementsByClassName('size-10')).toHaveLength(3);
    // The footer action-button bar only exists on the footer variant.
    expect(container.getElementsByClassName('h-8 w-20').length).toBe(3);
  });

  it('renders no footer bar by default', () => {
    const { container } = render(
      <Skeletonize loading label="Card">
        <CatalogCardSkeleton />
      </Skeletonize>,
    );
    expect(container.getElementsByClassName('h-8 w-20').length).toBe(0);
  });

  it('masks the bottom-right overflow menu on the menu variant', () => {
    const { container } = render(
      <Skeletonize loading label="Catalog">
        <CatalogGridSkeleton cards={3} menu />
      </Skeletonize>,
    );
    // One ⋯ placeholder per card, matching the loaded card's h-9 menu trigger.
    expect(container.getElementsByClassName('size-9')).toHaveLength(3);
  });

  it('renders no menu placeholder by default', () => {
    const { container } = render(
      <Skeletonize loading label="Card">
        <CatalogCardSkeleton />
      </Skeletonize>,
    );
    expect(container.getElementsByClassName('size-9').length).toBe(0);
  });

  describe('accessibility', () => {
    it('passes axe audit while masked', async () => {
      const { container } = render(
        <Skeletonize loading label="Catalog">
          <CatalogGridSkeleton footer />
        </Skeletonize>,
      );
      await checkAccessibility(container);
    });
  });
});
