import { describe, it, expect, vi } from 'vitest';

import { hexToHsl, isLightColor } from '../../../lib/utils/color';
import {
  mimeToExtension,
  parseBrandingJson,
  resolveBrandingDir,
  resolveBrandingFilePath,
  resolveImagePath,
  resolveImagesDir,
  serializeBrandingJson,
  validateImageFilename,
  validateImageType,
} from '../file_utils';

vi.stubEnv('TALE_CONFIG_DIR', '/tmp/test-data');

describe('parseBrandingJson', () => {
  it('parses valid branding JSON', () => {
    const input = JSON.stringify({
      appName: 'Acme',
      textLogo: 'A',
      brandColor: '#FF0000',
      accentColor: '#00FF00',
    });

    const result = parseBrandingJson(input);

    expect(result).toEqual({
      appName: 'Acme',
      textLogo: 'A',
      brandColor: '#FF0000',
      accentColor: '#00FF00',
    });
  });

  it('parses branding JSON with image filenames', () => {
    const input = JSON.stringify({
      appName: 'Acme',
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
      appName: 'Acme',
      brandColor: '#FF0000',
    };

    const serialized = serializeBrandingJson(config);
    const parsed = parseBrandingJson(serialized);

    expect(parsed.appName).toBe('Acme');
    expect(parsed.brandColor).toBe('#FF0000');
  });
});

describe('resolveBrandingDir', () => {
  it('returns base dir for default org', () => {
    expect(resolveBrandingDir('default')).toBe('/tmp/test-data/branding');
  });

  it('returns subdirectory for named org', () => {
    expect(resolveBrandingDir('acme')).toBe('/tmp/test-data/branding/acme');
  });

  it('throws for invalid org slug', () => {
    expect(() => resolveBrandingDir('../evil')).toThrow();
  });
});

describe('resolveBrandingFilePath', () => {
  it('returns branding.json path', () => {
    expect(resolveBrandingFilePath('default')).toBe(
      '/tmp/test-data/branding/branding.json',
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
    expect(validateImageFilename('../evil.png')).toBe(false);
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
  it('returns images subdirectory', () => {
    expect(resolveImagesDir('default')).toBe('/tmp/test-data/branding/images');
  });
});

describe('resolveImagePath', () => {
  it('resolves valid image filename', () => {
    expect(resolveImagePath('default', 'logo.png')).toBe(
      '/tmp/test-data/branding/images/logo.png',
    );
  });

  it('throws for invalid filename', () => {
    expect(() => resolveImagePath('default', '../evil.png')).toThrow();
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
