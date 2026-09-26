import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ExternalLink } from './external-link';

describe('ExternalLink', () => {
  it('renders an anchor with safe target+rel defaults', () => {
    render(<ExternalLink href="https://example.com">Example</ExternalLink>);
    const link = screen.getByRole('link', { name: /Example/ });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders the external icon by default', () => {
    const { container } = render(
      <ExternalLink href="https://example.com">Example</ExternalLink>,
    );
    // lucide-react renders an inline <svg>; presence is enough.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('hides the icon when showIcon is false', () => {
    const { container } = render(
      <ExternalLink href="https://example.com" showIcon={false}>
        Example
      </ExternalLink>,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('forwards extra props to the anchor', () => {
    render(
      <ExternalLink href="https://example.com" data-testid="ext">
        Example
      </ExternalLink>,
    );
    expect(screen.getByTestId('ext')).toBeInTheDocument();
  });

  it('keeps the caller className alongside the defaults', () => {
    render(
      <ExternalLink href="https://example.com" className="brand-link">
        Example
      </ExternalLink>,
    );
    expect(screen.getByRole('link', { name: /Example/ })).toHaveClass(
      'brand-link',
    );
  });

  it('keeps the icon on the same line even when the caller passes inline-block', () => {
    render(
      <ExternalLink href="https://example.com" className="inline-block text-sm">
        Arena Mode
      </ExternalLink>,
    );
    const link = screen.getByRole('link', { name: /Arena Mode/ });
    expect(link.className).toMatch(/\binline-flex\b/);
    expect(link.className).not.toMatch(/\binline-block\b/);
  });
});
