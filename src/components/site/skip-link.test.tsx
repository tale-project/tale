import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  it('renders an anchor pointing at #main by default', () => {
    render(<SkipLink>Skip to main</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip to main' });
    expect(link).toHaveAttribute('href', '#main');
  });

  it('honors a custom targetId', () => {
    render(<SkipLink targetId="content">Skip</SkipLink>);
    expect(screen.getByRole('link', { name: 'Skip' })).toHaveAttribute(
      'href',
      '#content',
    );
  });

  it('starts visually hidden via the sr-only class', () => {
    render(<SkipLink>Skip</SkipLink>);
    expect(screen.getByRole('link', { name: 'Skip' })).toHaveClass('sr-only');
  });

  it('forwards extra props onto the anchor', () => {
    render(
      <SkipLink data-testid="skip" id="my-skip">
        Jump
      </SkipLink>,
    );
    const link = screen.getByTestId('skip');
    expect(link).toHaveAttribute('id', 'my-skip');
  });

  it('merges caller className with defaults', () => {
    render(<SkipLink className="custom-class">Skip</SkipLink>);
    expect(screen.getByRole('link', { name: 'Skip' })).toHaveClass(
      'custom-class',
    );
  });

  it('moves focus into the target on activation', async () => {
    const { user } = render(
      <>
        <SkipLink targetId="main-content">Skip to main content</SkipLink>
        <main id="main-content" tabIndex={-1}>
          main
        </main>
      </>,
    );
    await user.click(
      screen.getByRole('link', { name: 'Skip to main content' }),
    );
    expect(document.getElementById('main-content')).toHaveFocus();
  });

  it('updates the hash on the current document when the target is missing', async () => {
    // Never the anchor's own navigation: under an injected `<base href>` a
    // bare `#fragment` resolves against the base and leaves the page.
    const path = window.location.pathname;
    const { user } = render(<SkipLink targetId="nowhere">Skip</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip' });
    await user.click(link);
    expect(link).toHaveAttribute('href', '#nowhere');
    expect(window.location.hash).toBe('#nowhere');
    expect(window.location.pathname).toBe(path);
    window.location.hash = '';
  });
});
