import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
      const user = userEvent.setup();
      render(
        <TooltipProvider>
          <ScrollToTop />
        </TooltipProvider>,
      );
      await user.click(screen.getByRole('button', { name: 'Back to top' }));
      expect(scroll).toHaveBeenCalledWith({
        top: 0,
        behavior: reducedMotion ? 'instant' : 'smooth',
      });
    },
  );
});
