import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SiteContainer } from './site-container';

describe('SiteContainer', () => {
  it('renders children inside a div', () => {
    render(<SiteContainer>Hello</SiteContainer>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('applies the design max-width + padding by default', () => {
    render(
      <SiteContainer data-testid="container">
        <span>child</span>
      </SiteContainer>,
    );
    const el = screen.getByTestId('container');
    expect(el.className).toContain('max-w-[1280px]');
    expect(el.className).toContain('px-6');
    expect(el.className).toContain('md:px-20');
    expect(el.className).toContain('mx-auto');
    expect(el.className).toContain('w-full');
  });

  it('merges caller className with the defaults', () => {
    render(
      <SiteContainer className="extra" data-testid="container">
        x
      </SiteContainer>,
    );
    expect(screen.getByTestId('container')).toHaveClass('extra');
  });

  it('forwards arbitrary props to the underlying div', () => {
    render(
      <SiteContainer id="my-id" data-testid="container">
        x
      </SiteContainer>,
    );
    expect(screen.getByTestId('container')).toHaveAttribute('id', 'my-id');
  });
});
