import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils/render';

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
});
