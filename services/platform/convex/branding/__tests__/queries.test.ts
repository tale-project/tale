import { describe, it, expect, vi } from 'vitest';

import { hexToHsl, isLightColor } from '../../../lib/utils/color';
import {
  parseBrandingJson,
  serializeBrandingJson,
  resolveBrandingDir,
  resolveBrandingFilePath,
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
