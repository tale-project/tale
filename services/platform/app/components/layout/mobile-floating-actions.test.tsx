// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import {
  MOBILE_FLOATING_ACTIONS_PAD,
  MOBILE_FLOATING_ACTIONS_PAD_VAR,
  MobileFloatingActions,
} from './mobile-floating-actions';

afterEach(() => {
  document.documentElement.style.removeProperty(
    MOBILE_FLOATING_ACTIONS_PAD_VAR,
  );
  document.documentElement.removeAttribute('data-floating-actions-pad-count');
});

describe('MobileFloatingActions', () => {
  it('portals a content-width dock to body, bottom-right above the bottom nav', async () => {
    render(
      <MobileFloatingActions>
        <button type="button">Save</button>
      </MobileFloatingActions>,
    );

    const save = await screen.findByRole('button', { name: 'Save' });
    const outer = save.closest('.fixed');
    expect(outer).not.toBeNull();
    expect(outer).toHaveClass('fixed', 'right-4', 'w-fit', 'md:hidden');
    expect(outer?.className).toContain(
      'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
    );
    expect(outer?.className).not.toContain('left-1/2');
    expect(document.body.contains(outer)).toBe(true);

    const inner = outer?.firstElementChild;
    expect(inner).toHaveClass('w-fit', 'rounded-xl', 'border', 'shadow-md');

    await waitFor(() => {
      expect(outer).not.toHaveClass('hidden');
    });
  });

  it('sets page bottom-pad while visible and clears it when empty', async () => {
    const { rerender } = render(
      <MobileFloatingActions>
        <button type="button">Save</button>
      </MobileFloatingActions>,
    );

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue(
          MOBILE_FLOATING_ACTIONS_PAD_VAR,
        ),
      ).toBe(MOBILE_FLOATING_ACTIONS_PAD);
    });

    function EmptySlot() {
      return null;
    }
    rerender(
      <MobileFloatingActions>
        <EmptySlot />
      </MobileFloatingActions>,
    );

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue(
          MOBILE_FLOATING_ACTIONS_PAD_VAR,
        ),
      ).toBe('');
    });
  });

  it('hides the dock when children render nothing', async () => {
    function EmptySlot() {
      return null;
    }

    render(
      <MobileFloatingActions>
        <EmptySlot />
      </MobileFloatingActions>,
    );

    await waitFor(() => {
      const dock = document.body.querySelector('.fixed.w-fit');
      expect(dock).not.toBeNull();
      expect(dock).toHaveClass('hidden');
      expect(dock).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('renders nothing before mount (SSR-safe)', async () => {
    const { container } = render(
      <div data-testid="host">
        <MobileFloatingActions>
          <button type="button">Discard</button>
        </MobileFloatingActions>
      </div>,
    );
    expect(
      container.querySelector('[data-testid="host"]')?.children,
    ).toHaveLength(0);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Discard' }),
      ).toBeInTheDocument();
      expect(
        container
          .querySelector('[data-testid="host"]')
          ?.contains(screen.getByRole('button', { name: 'Discard' })),
      ).toBe(false);
    });
  });
});
