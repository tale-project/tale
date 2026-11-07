import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ScrollToTop } from './scroll-to-top';

afterEach(() => vi.unstubAllGlobals());

describe('ScrollToTop', () => {
  it.each([true, false])(
    'honors reduced motion (%s) when returning to the top',
    async (reducedMotion) => {
      vi.stubGlobal('scrollY', 700);
      const scroll = vi.fn();
      vi.stubGlobal('scrollTo', scroll);
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reducedMotion,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      const { user } = render(<ScrollToTop />);
      await user.click(screen.getByRole('button', { name: 'Back to top' }));
      expect(scroll).toHaveBeenCalledWith({
        top: 0,
        behavior: reducedMotion ? 'instant' : 'smooth',
      });
    },
  );

  it('stays out of the tab order until the page has scrolled', () => {
    vi.stubGlobal('scrollY', 0);
    render(<ScrollToTop />);
    // Hidden from assistive tech while invisible, so it has no accessible
    // name to query by role — find it by its label attribute instead.
    const button = screen.getByLabelText('Back to top');
    expect(button).toHaveAttribute('tabindex', '-1');
    expect(button).toHaveAttribute('aria-hidden', 'true');
  });
});
