// @vitest-environment jsdom
import { useAccentColor } from '@tale/ui/accent-color';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveAccentPalette } from '@/lib/utils/color';

import { BrandingProvider, useBrandingContext } from './branding-provider';

// The provider reads the active org, its branding, and the resolved theme, then
// injects CSS variables on <html>. Mock the data sources so the test drives the
// branding values directly and pins the theme for deterministic colour math.
const brandingData = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@/app/features/settings/branding/hooks/queries', () => ({
  useBranding: () => ({ data: brandingData.current, refetch: vi.fn() }),
}));

vi.mock('@/app/lib/active-organization', () => ({
  useActiveOrganizationId: () => 'org_1',
}));

vi.mock('@tale/ui/theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

// Kept out of the test's way: the title-suffix effect only runs with an appName,
// and the router is never invalidated in these cases.
vi.mock('@/app/lib/title-suffix', () => ({ setTitleSuffix: () => false }));
vi.mock('@/app/router', () => ({ router: { invalidate: vi.fn() } }));

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

afterEach(() => {
  brandingData.current = undefined;
  document.documentElement.removeAttribute('style');
});

describe('BrandingProvider CSS injection', () => {
  it('derives the whole palette from the single accent color', () => {
    // #1960: one accent color drives BOTH token vocabularies. The canonical
    // `--color-accent-base` is what the primary Button consumes (regression
    // for #2394 — injecting only `--primary` had no visible primary effect).
    brandingData.current = { accentColor: '#FF0055' };

    render(<BrandingProvider>content</BrandingProvider>);

    const palette = deriveAccentPalette('#FF0055', 'light');
    expect(readVar('--color-accent-base').toLowerCase()).toBe(
      palette.base.toLowerCase(),
    );
    expect(readVar('--color-accent-fg').toLowerCase()).toBe(
      palette.fg.toLowerCase(),
    );
    // The legacy HSL tokens carry the accent where it is the ink itself —
    // `text-primary` links, mentions and citations, unread dots, the focus
    // ring — so they get the text shade, not the 3:1 surface.
    expect(readVar('--primary')).toBe(palette.textHsl);
    expect(readVar('--primary-foreground')).toBe(palette.onTextHsl);
    expect(readVar('--primary-muted')).toBe(palette.mutedHsl);
    expect(readVar('--ring')).toBe(palette.textHsl);
  });

  it('hands tinted navigation the text shade, not the raw pick', () => {
    // #FF00FF clears 3:1 on the light page, so it stays the button's fill —
    // but the open row sets the context accent as its text, where it read
    // 2.4:1 on its own tint.
    brandingData.current = { accentColor: '#FF00FF' };

    function Probe() {
      return (
        <>
          <span data-testid="context">{useBrandingContext().accentColor}</span>
          <span data-testid="tinted">{useAccentColor()}</span>
        </>
      );
    }
    render(
      <BrandingProvider>
        <Probe />
      </BrandingProvider>,
    );

    const palette = deriveAccentPalette('#FF00FF', 'light');
    expect(palette.text).not.toBe(palette.base.toLowerCase());
    expect(screen.getByTestId('context').textContent).toBe(palette.text);
    expect(screen.getByTestId('tinted').textContent).toBe(palette.text);
    expect(readVar('--color-accent-base')).toBe('#FF00FF');
  });

  it('does not touch any palette token when no accent color is set', () => {
    brandingData.current = {};

    render(<BrandingProvider>content</BrandingProvider>);

    expect(readVar('--color-accent-base')).toBe('');
    expect(readVar('--primary')).toBe('');
    expect(readVar('--primary-muted')).toBe('');
    expect(readVar('--ring')).toBe('');
  });

  it('ignores the dropped legacy brandColor field', () => {
    // The server no longer returns `brandColor` (it coalesces legacy files
    // into `accentColor`); a stale payload carrying only the old field must
    // not restyle anything.
    brandingData.current = { brandColor: '#FF0055' };

    render(<BrandingProvider>content</BrandingProvider>);

    expect(readVar('--color-accent-base')).toBe('');
    expect(readVar('--primary')).toBe('');
  });
});
