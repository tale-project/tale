// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { BrandingPreview } from '../branding-preview';

// Mock Image component
vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => (
    <img
      src={props.src as string}
      alt={props.alt as string}
      data-testid="preview-image"
    />
  ),
}));

afterEach(cleanup);

describe('BrandingPreview', () => {
  it('renders with role="img" and aria-label', () => {
    render(<BrandingPreview data={{}} />);

    expect(
      screen.getByRole('img', { name: 'Branding preview' }),
    ).toBeInTheDocument();
  });

  it('renders placeholder bar when no app name provided', () => {
    render(<BrandingPreview data={{}} />);

    const chrome = screen.getByTestId('browser-chrome');
    const placeholder = chrome.querySelector('.bg-border.h-2');
    expect(placeholder).toBeInTheDocument();
    expect(screen.queryByText('Tale')).not.toBeInTheDocument();
  });

  it('renders custom app name', () => {
    render(<BrandingPreview data={{ appName: 'Acme Corp' }} />);

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.queryByText('Tale')).not.toBeInTheDocument();
  });

  it('renders custom text logo', () => {
    render(<BrandingPreview data={{ textLogo: 'ACME' }} />);

    expect(screen.getByText('ACME')).toBeInTheDocument();
  });

  it('renders logo image when URL provided', () => {
    render(
      <BrandingPreview data={{ logoUrl: 'https://example.com/logo.png' }} />,
    );

    const img = screen.getByTestId('preview-image');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('prefers logo image over text logo', () => {
    render(
      <BrandingPreview
        data={{
          logoUrl: 'https://example.com/logo.png',
          textLogo: 'ACME',
        }}
      />,
    );

    expect(screen.getByTestId('preview-image')).toBeInTheDocument();
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
  });

  it('applies accent color to tab border', () => {
    render(<BrandingPreview data={{ accentColor: '#FF5500' }} />);

    const openTab = screen.getByText('Open');
    expect(openTab).toHaveStyle({ borderColor: '#FF5500' });
  });

  it('applies accent color to first nav icon', () => {
    const { container } = render(
      <BrandingPreview data={{ accentColor: '#00AAFF' }} />,
    );

    const navIcons = container.querySelectorAll('svg');
    const firstIcon = navIcons[0];
    expect(firstIcon).toBeDefined();
    if (firstIcon) {
      expect(firstIcon).toHaveStyle({ color: '#00AAFF' });
    }
  });

  it('renders browser chrome dots', () => {
    render(<BrandingPreview data={{}} />);

    const chrome = screen.getByTestId('browser-chrome');
    const dots = chrome.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(3);
  });

  it('renders tab navigation items', () => {
    render(<BrandingPreview data={{}} />);

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Spam')).toBeInTheDocument();
  });

  it('renders placeholder content rows', () => {
    const { container } = render(<BrandingPreview data={{}} />);

    // 4 placeholder avatar circles
    const avatars = container.querySelectorAll('.rounded-full.bg-muted');
    expect(avatars.length).toBe(4);
  });

  it('applies text logo color from brand color', () => {
    render(
      <BrandingPreview data={{ textLogo: 'ACME', brandColor: '#FF0000' }} />,
    );

    const textLogo = screen.getByText('ACME');
    expect(textLogo).toHaveStyle({ color: '#FF0000' });
  });
});
