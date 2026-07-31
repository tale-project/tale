import { describe, expect, it } from 'vitest';

import {
  automationDisplayDescription,
  automationDisplayName,
  parseAutomationPresentation,
  titleFromSlug,
} from './automation_presentation';

const PACK = {
  name: 'Cascadia levy return desk',
  description: 'Prepares quarterly Cascadia packaging-levy returns.',
  icon: 'receipt',
  labels: ['Levy', 'Cascadia'],
  i18n: {
    de: { name: 'Cascadia Abgabe-Arbeitsplatz' },
    fr: {
      name: 'Bureau de redevance Cascadia',
      description:
        'Prépare les déclarations de redevance Cascadia trimestrielles.',
    },
  },
};

describe('parseAutomationPresentation', () => {
  it('accepts a pack manifest s display half', () => {
    expect(parseAutomationPresentation(PACK)?.name).toBe(
      'Cascadia levy return desk',
    );
  });

  it('reads an unusable value as none rather than throwing', () => {
    expect(parseAutomationPresentation({ labels: 'Levy' })).toBeNull();
    expect(parseAutomationPresentation(undefined)).toBeNull();
  });
});

describe('titleFromSlug', () => {
  it('reads a slug as a title, dropping the namespace', () => {
    expect(titleFromSlug('github/triage-issues')).toBe('Triage issues');
    expect(titleFromSlug('levy-return-desk')).toBe('Levy return desk');
    expect(titleFromSlug('weekly_report')).toBe('Weekly report');
  });

  it('keeps a slug that has nothing to title', () => {
    expect(titleFromSlug('-')).toBe('-');
  });
});

describe('automationDisplayName', () => {
  it('prefers the declared name over the slug', () => {
    expect(automationDisplayName(PACK, 'levy-return-desk', 'en')).toBe(
      'Cascadia levy return desk',
    );
  });

  it('follows the locale chain: exact tag, base language, then English', () => {
    expect(automationDisplayName(PACK, 'levy-return-desk', 'de')).toBe(
      'Cascadia Abgabe-Arbeitsplatz',
    );
    expect(automationDisplayName(PACK, 'levy-return-desk', 'de-CH')).toBe(
      'Cascadia Abgabe-Arbeitsplatz',
    );
    expect(automationDisplayName(PACK, 'levy-return-desk', 'it')).toBe(
      'Cascadia levy return desk',
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
      'Prépare les déclarations de redevance Cascadia trimestrielles.',
    );
    expect(automationDisplayDescription(PACK, 'de')).toBe(
      'Prepares quarterly Cascadia packaging-levy returns.',
    );
  });

  it('has nothing to say without a presentation', () => {
    expect(automationDisplayDescription(null, 'en')).toBeUndefined();
  });
});
