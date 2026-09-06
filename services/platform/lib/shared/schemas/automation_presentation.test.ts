import { describe, expect, it } from 'vitest';

import {
  automationDisplayDescription,
  automationDisplayIcon,
  automationDisplayLabels,
  automationDisplayName,
  parseAutomationPresentation,
  titleFromSlug,
} from './automation_presentation';

const PACK = {
  name: 'Document verification desk',
  description: 'Checks and validates a batch of incoming documents.',
  icon: 'file-check',
  labels: ['Review', 'Documents'],
  i18n: {
    de: { name: 'Dokumentenprüfung-Arbeitsplatz' },
    fr: {
      name: 'Bureau de vérification documentaire',
      description: 'Vérifie et valide un lot de documents entrants.',
    },
  },
};

describe('parseAutomationPresentation', () => {
  it('accepts a pack manifest s display half', () => {
    expect(parseAutomationPresentation(PACK)?.name).toBe(
      'Document verification desk',
    );
  });

  it('reads an unusable value as none rather than throwing', () => {
    expect(parseAutomationPresentation({ labels: 'Review' })).toBeNull();
    expect(parseAutomationPresentation(undefined)).toBeNull();
  });
});

describe('titleFromSlug', () => {
  it('reads a slug as a title, dropping the namespace', () => {
    expect(titleFromSlug('github/triage-issues')).toBe('Triage issues');
    expect(titleFromSlug('document-verify-desk')).toBe('Document verify desk');
    expect(titleFromSlug('weekly_report')).toBe('Weekly report');
  });

  it('keeps a slug that has nothing to title', () => {
    expect(titleFromSlug('-')).toBe('-');
  });
});

describe('automationDisplayName', () => {
  it('prefers the declared name over the slug', () => {
    expect(automationDisplayName(PACK, 'document-verify-desk', 'en')).toBe(
      'Document verification desk',
    );
  });

  it('follows the locale chain: exact tag, base language, then English', () => {
    expect(automationDisplayName(PACK, 'document-verify-desk', 'de')).toBe(
      'Dokumentenprüfung-Arbeitsplatz',
    );
    expect(automationDisplayName(PACK, 'document-verify-desk', 'de-CH')).toBe(
      'Dokumentenprüfung-Arbeitsplatz',
    );
    expect(automationDisplayName(PACK, 'document-verify-desk', 'it')).toBe(
      'Document verification desk',
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
      'Vérifie et valide un lot de documents entrants.',
    );
    expect(automationDisplayDescription(PACK, 'de')).toBe(
      'Checks and validates a batch of incoming documents.',
    );
  });

  it('has nothing to say without a presentation', () => {
    expect(automationDisplayDescription(null, 'en')).toBeUndefined();
  });
});

describe('automationDisplayIcon', () => {
  it('speaks the Iconify id the renderer resolves offline', () => {
    expect(automationDisplayIcon(PACK)).toBe('lucide:file-check');
  });

  it('leaves the renderer to its fallback when nothing was declared', () => {
    expect(automationDisplayIcon({ name: 'Weekly report' })).toBeUndefined();
    expect(automationDisplayIcon(undefined)).toBeUndefined();
  });
});

describe('automationDisplayLabels', () => {
  it('keeps the declared chips in declaration order', () => {
    expect(automationDisplayLabels(PACK)).toEqual(['Review', 'Documents']);
  });

  it('reads no chips from an undeclared or unusable presentation', () => {
    expect(automationDisplayLabels({ name: 'Weekly report' })).toEqual([]);
    expect(automationDisplayLabels({ labels: 'Review' })).toEqual([]);
  });
});
