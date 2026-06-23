import { describe, it, expect, vi } from 'vitest';

import { hexToHsl, isLightColor } from '../../lib/utils/color';
import {
  buildBrandingImageUrl,
  mimeToExtension,
  parseBrandingJson,
  resolveBrandingDir,
  resolveBrandingFilePath,
  resolveImagePath,
  resolveImagesDir,
  serializeBrandingJson,
  validateImageFilename,
  validateImageType,
} from './file_utils';

vi.stubEnv('TALE_CONFIG_DIR', '/tmp/test-data');

describe('parseBrandingJson', () => {
  it('parses valid branding JSON', () => {
    const input = JSON.stringify({
      brandColor: '#FF0000',
      accentColor: '#00FF00',
    });

    const result = parseBrandingJson(input);

    expect(result).toEqual({
      brandColor: '#FF0000',
      accentColor: '#00FF00',
    });
  });

  it('strips legacy app-name / text-logo keys (no migration needed)', () => {
    const input = JSON.stringify({
      appName: 'Acme',
      textLogo: 'A',
      brandColor: '#FF0000',
    });

    const result = parseBrandingJson(input);

    expect(result).toEqual({ brandColor: '#FF0000' });
    expect('appName' in result).toBe(false);
    expect('textLogo' in result).toBe(false);
  });

  it('parses branding JSON with image filenames', () => {
    const input = JSON.stringify({
      logoFilename: 'logo.png',
      faviconLightFilename: 'favicon-light.ico',
      faviconDarkFilename: 'favicon-dark.ico',
    });

    const result = parseBrandingJson(input);

    expect(result.logoFilename).toBe('logo.png');
    expect(result.faviconLightFilename).toBe('favicon-light.ico');
    expect(result.faviconDarkFilename).toBe('favicon-dark.ico');
  });

  it('parses minimal branding JSON', () => {
    const result = parseBrandingJson('{}');
    expect(result).toEqual({});
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBrandingJson('not json')).toThrow();
  });
});

describe('serializeBrandingJson', () => {
  it('round-trips through parse', () => {
    const config = {
      brandColor: '#FF0000',
      accentColor: '#00FF00',
    };

    const serialized = serializeBrandingJson(config);
    const parsed = parseBrandingJson(serialized);

    expect(parsed.brandColor).toBe('#FF0000');
    expect(parsed.accentColor).toBe('#00FF00');
  });
});

describe('resolveBrandingDir (org-first)', () => {
  it('default org lives at <root>/default/branding/', () => {
    expect(resolveBrandingDir('default')).toBe(
      '/tmp/test-data/default/branding',
    );
  });

  it('other orgs live at <root>/<orgSlug>/branding/ (read-side is default-only today)', () => {
    expect(resolveBrandingDir('acme')).toBe('/tmp/test-data/acme/branding');
  });

  it('throws for invalid org slug', () => {
    expect(() => resolveBrandingDir('./evil')).toThrow();
  });
});

describe('resolveBrandingFilePath', () => {
  it('returns branding.json path under <org>/branding/', () => {
    expect(resolveBrandingFilePath('default')).toBe(
      '/tmp/test-data/default/branding/branding.json',
    );
  });
});

describe('validateImageType', () => {
  it('accepts valid image types', () => {
    expect(validateImageType('logo')).toBe(true);
    expect(validateImageType('favicon-light')).toBe(true);
    expect(validateImageType('favicon-dark')).toBe(true);
  });

  it('rejects invalid types', () => {
    expect(validateImageType('banner')).toBe(false);
    expect(validateImageType('')).toBe(false);
  });
});

describe('validateImageFilename', () => {
  it('accepts valid filenames', () => {
    expect(validateImageFilename('logo.png')).toBe(true);
    expect(validateImageFilename('favicon-light.svg')).toBe(true);
    expect(validateImageFilename('favicon-dark.ico')).toBe(true);
  });

  it('rejects invalid filenames', () => {
    expect(validateImageFilename('./evil.png')).toBe(false);
    expect(validateImageFilename('logo.exe')).toBe(false);
    expect(validateImageFilename('LOGO.PNG')).toBe(false);
    expect(validateImageFilename('')).toBe(false);
  });
});

describe('mimeToExtension', () => {
  it('maps known MIME types', () => {
    expect(mimeToExtension('image/png')).toBe('png');
    expect(mimeToExtension('image/svg+xml')).toBe('svg');
    expect(mimeToExtension('image/jpeg')).toBe('jpg');
    expect(mimeToExtension('image/webp')).toBe('webp');
    expect(mimeToExtension('image/x-icon')).toBe('ico');
  });

  it('returns null for unknown types', () => {
    expect(mimeToExtension('application/pdf')).toBeNull();
    expect(mimeToExtension('text/plain')).toBeNull();
  });
});

describe('resolveImagesDir', () => {
  it('returns images subdirectory under <org>/branding/', () => {
    expect(resolveImagesDir('default')).toBe(
      '/tmp/test-data/default/branding/images',
    );
  });
});

describe('buildBrandingImageUrl', () => {
  it('returns null when there is no filename', () => {
    expect(buildBrandingImageUrl('acme', undefined)).toBeNull();
    expect(buildBrandingImageUrl('acme', '')).toBeNull();
  });

  it('segments the org slug into the path (matches the static image route)', () => {
    // Pin env so the URL is deterministic regardless of the ambient test env.
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('BASE_PATH', '');
    // The org slug is a path segment so server.ts
    // `/branding/images/:orgSlug/:filename` resolves the right org bucket.
    expect(buildBrandingImageUrl('acme', 'logo.png')).toBe(
      '/branding/images/acme/logo.png',
    );
    // Different orgs produce different URLs — no cross-org bleed.
    expect(buildBrandingImageUrl('default', 'logo.png')).toBe(
      '/branding/images/default/logo.png',
    );
    vi.unstubAllEnvs();
    vi.stubEnv('TALE_CONFIG_DIR', '/tmp/test-data');
  });

  it('prefixes SITE_URL (trailing slash trimmed) and BASE_PATH', () => {
    vi.stubEnv('SITE_URL', 'https://tale.example.com/');
    vi.stubEnv('BASE_PATH', '/app');
    expect(buildBrandingImageUrl('acme', 'favicon-light.ico')).toBe(
      'https://tale.example.com/app/branding/images/acme/favicon-light.ico',
    );
    vi.unstubAllEnvs();
    vi.stubEnv('TALE_CONFIG_DIR', '/tmp/test-data');
  });
});

describe('resolveImagePath', () => {
  it('resolves valid image filename', () => {
    expect(resolveImagePath('default', 'logo.png')).toBe(
      '/tmp/test-data/default/branding/images/logo.png',
    );
  });

  it('throws for invalid filename', () => {
    expect(() => resolveImagePath('default', './evil.png')).toThrow();
  });
});

describe('hexToHsl', () => {
  it('converts pure red', () => {
    expect(hexToHsl('#FF0000')).toBe('0 100% 50%');
  });

  it('converts black', () => {
    expect(hexToHsl('#000000')).toBe('0 0% 0%');
  });

  it('converts white', () => {
    expect(hexToHsl('#FFFFFF')).toBe('0 0% 100%');
  });
});

describe('isLightColor', () => {
  it('white is light', () => {
    expect(isLightColor('#FFFFFF')).toBe(true);
  });

  it('black is not light', () => {
    expect(isLightColor('#000000')).toBe(false);
  });
});
