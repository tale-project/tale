import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<SkipLink />);
      await checkAccessibility(container);
    });
  });

  it('moves focus into #main-content on activation', async () => {
    const { user } = render(
      <>
        <SkipLink />
        <main id="main-content" tabIndex={-1}>
          main
        </main>
      </>,
    );
    const skipLink = screen.getByRole('link', {
      name: 'Skip to main content',
    });
    const main = document.getElementById('main-content') as HTMLElement;

    await user.click(skipLink);

    expect(main).toHaveFocus();
  });
});
