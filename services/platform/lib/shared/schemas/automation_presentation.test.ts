import { describe, expect, it } from 'vitest';

import {
  automationDisplayDescription,
  automationDisplayName,
  parseAutomationPresentation,
  titleFromSlug,
} from './automation_presentation';

const PACK = {
  name: 'Swiss VAT return desk',
  description: 'Prepares quarterly Swiss VAT returns.',
  icon: 'receipt',
  labels: ['MWST', 'Swiss'],
  i18n: {
    de: { name: 'Schweizer MWST-Arbeitsplatz' },
    fr: {
      name: 'Bureau TVA suisse',
      description: 'Prépare les décomptes TVA suisses trimestriels.',
    },
  },
};

describe('parseAutomationPresentation', () => {
  it('accepts a pack manifest s display half', () => {
    expect(parseAutomationPresentation(PACK)?.name).toBe(
      'Swiss VAT return desk',
    );
  });

  it('reads an unusable value as none rather than throwing', () => {
    expect(parseAutomationPresentation({ labels: 'MWST' })).toBeNull();
    expect(parseAutomationPresentation(undefined)).toBeNull();
  });
});

describe('titleFromSlug', () => {
  it('reads a slug as a title, dropping the namespace', () => {
    expect(titleFromSlug('github/triage-issues')).toBe('Triage issues');
    expect(titleFromSlug('vat-return-desk')).toBe('Vat return desk');
    expect(titleFromSlug('weekly_report')).toBe('Weekly report');
  });

  it('keeps a slug that has nothing to title', () => {
    expect(titleFromSlug('-')).toBe('-');
  });
});

describe('automationDisplayName', () => {
  it('prefers the declared name over the slug', () => {
    expect(automationDisplayName(PACK, 'vat-return-desk', 'en')).toBe(
      'Swiss VAT return desk',
    );
  });

  it('follows the locale chain: exact tag, base language, then English', () => {
    expect(automationDisplayName(PACK, 'vat-return-desk', 'de')).toBe(
      'Schweizer MWST-Arbeitsplatz',
    );
    expect(automationDisplayName(PACK, 'vat-return-desk', 'de-CH')).toBe(
      'Schweizer MWST-Arbeitsplatz',
    );
    expect(automationDisplayName(PACK, 'vat-return-desk', 'it')).toBe(
      'Swiss VAT return desk',
    );
  });

  it('falls back to the slug as a title when nothing was declared', () => {
    expect(automationDisplayName(undefined, 'github/triage-issues', 'en')).toBe(
      'Triage issues',
    );
  });
});

describe('automationDisplayDescription', () => {
  it('translates when the locale declares one, else keeps English', () => {
    expect(automationDisplayDescription(PACK, 'fr')).toBe(
      'Prépare les décomptes TVA suisses trimestriels.',
    );
    expect(automationDisplayDescription(PACK, 'de')).toBe(
      'Prepares quarterly Swiss VAT returns.',
    );
  });

  it('has nothing to say without a presentation', () => {
    expect(automationDisplayDescription(null, 'en')).toBeUndefined();
  });
});
