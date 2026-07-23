// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import enMessages from '@/messages/en.yml';
import { checkAccessibility } from '@/tests/utils/a11y';

import { BrandingPreview } from './branding-preview';

// Mock useT against en.json so tests match rendered prose, not raw keys.
function lookup(ns: string, key: string): string {
  const segments = `${ns}.${key}`.split('.');
  let cursor: unknown = enMessages;
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in cursor) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return `${ns}.${key}`;
    }
  }
  return typeof cursor === 'string' ? cursor : `${ns}.${key}`;
}

// Theme drives the per-theme color adjustment; pin it to light for determinism.
vi.mock('@tale/ui/theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      let out = lookup(ns, key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
      }
      return out;
    },
  }),
}));

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

  it('renders the organization name (chrome + sidebar wordmark)', () => {
    render(<BrandingPreview data={{ appName: 'Acme Corp' }} />);

    // Shown both in the browser-chrome tab title and the sidebar wordmark.
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
    expect(screen.queryByText('Tale')).not.toBeInTheDocument();
  });

  it('renders logo image when URL provided', () => {
    render(
      <BrandingPreview data={{ logoUrl: 'https://example.com/logo.png' }} />,
    );

    const img = screen.getByTestId('preview-image');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('prefers the logo image over the org-name wordmark in the sidebar', () => {
    const { container } = render(
      <BrandingPreview
        data={{
          logoUrl: 'https://example.com/logo.png',
          appName: 'ACME',
        }}
      />,
    );

    expect(screen.getByTestId('preview-image')).toBeInTheDocument();
    // The bold sidebar wordmark is not rendered when a logo image wins.
    expect(container.querySelector('.font-bold')).toBeNull();
  });

  it('applies accent color to tab border', () => {
    render(<BrandingPreview data={{ accentColor: '#FF5500' }} />);

    const openTab = screen.getByText('Open');
    expect(openTab).toHaveStyle({ borderColor: '#FF5500' });
  });

  it('applies accent color to first nav icon', () => {
    // #0066CC already clears 3:1 against the (mocked light) background, so the
    // theme adjustment is a no-op and the exact color is applied.
    const { container } = render(
      <BrandingPreview data={{ accentColor: '#0066CC' }} />,
    );

    const navIcons = container.querySelectorAll('svg');
    const firstIcon = navIcons[0];
    expect(firstIcon).toBeDefined();
    if (firstIcon) {
      expect(firstIcon).toHaveStyle({ color: '#0066CC' });
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

  it('applies the accent color to the sidebar org-name wordmark', () => {
    // The single accent drives the wordmark too (the brand color was dropped
    // for the derived palette, #1960).
    const { container } = render(
      <BrandingPreview data={{ appName: 'ACME', accentColor: '#FF0000' }} />,
    );

    // #FF0000 already clears contrast on the light theme, so it's applied as-is.
    const wordmark = container.querySelector('.font-bold');
    expect(wordmark).not.toBeNull();
    expect(wordmark).toHaveStyle({ color: '#FF0000' });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<BrandingPreview data={{}} />);
      await checkAccessibility(container);
    });
  });
});
