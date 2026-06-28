import { describe, expect, it } from 'vitest';

import type { BrandingJsonConfig } from '../../branding/file_utils';
import {
  agentHasPptxSkill,
  buildBrandingPromptSection,
  PPTX_SKILL_SLUG,
} from './branding_context';

describe('agentHasPptxSkill', () => {
  it('is true only when the pptx slug is bound', () => {
    expect(agentHasPptxSkill([PPTX_SKILL_SLUG])).toBe(true);
    expect(agentHasPptxSkill(['other', 'pptx'])).toBe(true);
    expect(agentHasPptxSkill(['docx'])).toBe(false);
    expect(agentHasPptxSkill([])).toBe(false);
    expect(agentHasPptxSkill(undefined)).toBe(false);
  });
});

describe('buildBrandingPromptSection', () => {
  it('returns empty string when there is no config', () => {
    expect(buildBrandingPromptSection('acme', null)).toBe('');
  });

  it('returns empty string when every branding field is unset or blank', () => {
    const config: BrandingJsonConfig = {
      brandColor: '',
      accentColor: undefined,
      logoFilename: undefined,
    };
    expect(buildBrandingPromptSection('acme', config)).toBe('');
  });

  it('includes brand and accent colors when set', () => {
    const config: BrandingJsonConfig = {
      brandColor: '#123456',
      accentColor: '#abcdef',
    };
    const section = buildBrandingPromptSection('acme', config);
    expect(section).toContain('Corporate Identity (Presentation Branding)');
    expect(section).toContain('#123456');
    expect(section).toContain('#abcdef');
    // Frames the values as overridable defaults.
    expect(section).toContain('override');
    // No logo filename -> no logo line.
    expect(section).not.toContain('Logo');
  });

  it('omits the brand-color line but keeps the accent line', () => {
    const config: BrandingJsonConfig = {
      brandColor: '',
      accentColor: '#00ff00',
    };
    const section = buildBrandingPromptSection('acme', config);
    expect(section).toContain('#00ff00');
    expect(section).not.toContain('Brand color');
    expect(section).toContain('Accent color');
  });

  it('includes a same-origin logo URL when a logo filename and SITE_URL are set', () => {
    const prevSite = process.env.SITE_URL;
    const prevBase = process.env.BASE_PATH;
    process.env.SITE_URL = 'https://app.example.com';
    process.env.BASE_PATH = '';
    try {
      const config: BrandingJsonConfig = {
        brandColor: '#123456',
        logoFilename: 'logo.png',
      };
      const section = buildBrandingPromptSection('acme', config);
      expect(section).toContain(
        'https://app.example.com/branding/images/acme/logo.png',
      );
      expect(section).toContain('Logo');
    } finally {
      if (prevSite === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSite;
      if (prevBase === undefined) delete process.env.BASE_PATH;
      else process.env.BASE_PATH = prevBase;
    }
  });

  it('renders only the logo when colors are unset', () => {
    const prevSite = process.env.SITE_URL;
    process.env.SITE_URL = 'https://app.example.com';
    try {
      const config: BrandingJsonConfig = {
        logoFilename: 'mark.svg',
      };
      const section = buildBrandingPromptSection('acme', config);
      expect(section).toContain('mark.svg');
      expect(section).not.toContain('Brand color');
      expect(section).not.toContain('Accent color');
    } finally {
      if (prevSite === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSite;
    }
  });
});
