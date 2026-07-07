// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveAccentPalette } from '@/lib/utils/color';

import { BrandingProvider } from './branding-provider';

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
    // The legacy HSL tokens stay wired too (badges, chat cards, focus ring).
    expect(readVar('--primary')).toBe(palette.baseHsl);
    expect(readVar('--primary-foreground')).toBe(palette.fgHsl);
    expect(readVar('--primary-muted')).toBe(palette.mutedHsl);
    expect(readVar('--ring')).toBe(palette.baseHsl);
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
