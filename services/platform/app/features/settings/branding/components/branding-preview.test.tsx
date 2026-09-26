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

vi.mock('@tale/ui/i18n/client', () => ({
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
vi.mock('@/app/components/image', () => ({
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

  it('marks the open Home section with the accent, as the live rail does', () => {
    // #0066CC already clears 3:1 against the (mocked light) background, so the
    // theme adjustment is a no-op and the exact color is applied.
    render(<BrandingPreview data={{ accentColor: '#0066CC' }} />);

    const tile = screen.getByTestId('preview-rail-active');
    expect(tile).toHaveStyle({ backgroundColor: '#0066CC26' });
    expect(tile.querySelector('svg')).toHaveStyle({ color: '#0066CC' });
  });

  it('renders browser chrome dots', () => {
    render(<BrandingPreview data={{}} />);

    const chrome = screen.getByTestId('browser-chrome');
    const dots = chrome.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(3);
  });

  it('draws the Home panel with its live view labels', () => {
    render(<BrandingPreview data={{}} />);

    const panel = screen.getByTestId('preview-home-panel');
    expect(panel).toHaveTextContent('Home');
    for (const label of ['All', 'Chats', 'Tasks', 'Inbox']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('preview-row')).toHaveLength(4);
  });

  it('no longer draws the retired inbox tabs', () => {
    render(<BrandingPreview data={{}} />);

    expect(screen.queryByText('Spam')).not.toBeInTheDocument();
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
