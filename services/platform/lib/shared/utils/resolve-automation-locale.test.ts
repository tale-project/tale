import { describe, expect, it } from 'vitest';

import {
  humanizeFieldKey,
  resolveAutomationLocale,
  resolveConfigFieldLocale,
  resolveLocalizedProp,
} from './resolve-automation-locale';

describe('resolveAutomationLocale', () => {
  it('returns i18n[locale] name/description when present', () => {
    const app = {
      name: 'Resolve GitHub issues',
      description: 'Syncs open GitHub issues into the project backlog.',
      i18n: {
        de: { name: 'GitHub-Issues lösen', description: 'DE description' },
      },
    };
    expect(resolveAutomationLocale(app, 'de')).toEqual({
      name: 'GitHub-Issues lösen',
      description: 'DE description',
    });
  });

  it('narrows de-CH to i18n.de when only de is populated', () => {
    const app = { name: 'Desk', i18n: { de: { name: 'Deutsch' } } };
    expect(resolveAutomationLocale(app, 'de-CH').name).toBe('Deutsch');
  });

  it('prefers a direct locale match over its narrowed base', () => {
    const app = {
      name: 'Desk',
      i18n: { de: { name: 'Deutsch' }, 'de-CH': { name: 'Schweizerdeutsch' } },
    };
    expect(resolveAutomationLocale(app, 'de-CH').name).toBe('Schweizerdeutsch');
  });

  it('falls back to i18n.en for an unrelated locale, never i18n.de', () => {
    const app = {
      name: 'Desk',
      i18n: { en: { name: 'EN name' }, de: { name: 'DE name' } },
    };
    expect(resolveAutomationLocale(app, 'es').name).toBe('EN name');
  });

  it('falls back to the top-level literal when i18n has no entry for the field', () => {
    const app = {
      name: 'Top-level name',
      description: 'Top-level description',
      i18n: { de: { name: 'DE name' } }, // no de description
    };
    const result = resolveAutomationLocale(app, 'de');
    expect(result.name).toBe('DE name');
    expect(result.description).toBe('Top-level description');
  });

  it('resolves a legacy manifest with no i18n block to its top-level literals', () => {
    const app = { name: 'Legacy', description: 'Legacy description' };
    expect(resolveAutomationLocale(app, 'de')).toEqual({
      name: 'Legacy',
      description: 'Legacy description',
    });
  });

  it('defaults description to an empty string when absent everywhere', () => {
    const app = { name: 'Desk' };
    expect(resolveAutomationLocale(app, 'en')).toEqual({
      name: 'Desk',
      description: '',
    });
  });

  it('skips an empty-string i18n override to the next layer', () => {
    const app = {
      name: 'Top',
      i18n: { en: { name: '' } },
    };
    expect(resolveAutomationLocale(app, 'en').name).toBe('Top');
  });
});

describe('humanizeFieldKey', () => {
  it('start-cases the last dotted segment', () => {
    expect(humanizeFieldKey('config.repo')).toBe('Repo');
  });

  it('splits camelCase into separate words', () => {
    expect(humanizeFieldKey('testCommand')).toBe('Test Command');
  });

  it('replaces underscores/hyphens with spaces', () => {
    expect(humanizeFieldKey('repo_notes')).toBe('Repo Notes');
    expect(humanizeFieldKey('repo-notes')).toBe('Repo Notes');
  });

  it('handles a bare single-word key', () => {
    expect(humanizeFieldKey('repo')).toBe('Repo');
  });
});

describe('resolveLocalizedProp', () => {
  const i18n = {
    de: { text: 'Deutscher Text' },
    'de-CH': { text: 'Schweizer Text' },
    en: { text: 'English text' },
  };

  it('returns i18n[locale][prop] when present', () => {
    expect(resolveLocalizedProp('Base', i18n, 'text', 'de')).toBe(
      'Deutscher Text',
    );
  });

  it('narrows de-CH to i18n.de when only de is populated', () => {
    expect(
      resolveLocalizedProp(
        'Base',
        { de: { text: 'Deutsch' } },
        'text',
        'de-CH',
      ),
    ).toBe('Deutsch');
  });

  it('prefers a direct locale match over its narrowed base', () => {
    expect(resolveLocalizedProp('Base', i18n, 'text', 'de-CH')).toBe(
      'Schweizer Text',
    );
  });

  it('falls back to i18n.en for an unrelated locale', () => {
    expect(resolveLocalizedProp('Base', i18n, 'text', 'es')).toBe(
      'English text',
    );
  });

  it('falls back to the base literal when i18n has no entry', () => {
    expect(resolveLocalizedProp('Base literal', undefined, 'text', 'de')).toBe(
      'Base literal',
    );
  });

  it('skips an empty-string override to the next layer', () => {
    expect(
      resolveLocalizedProp(
        'Base',
        { de: { text: '' }, en: { text: 'English' } },
        'text',
        'de',
      ),
    ).toBe('English');
  });

  it('returns undefined when base and i18n are both absent', () => {
    expect(resolveLocalizedProp(undefined, undefined, 'text', 'de')).toBe(
      undefined,
    );
  });

  it('skips non-string passthrough values and falls through', () => {
    expect(
      resolveLocalizedProp(
        'Base',
        { de: { text: 42, other: true }, en: { text: 'English' } },
        'text',
        'de',
      ),
    ).toBe('English');
  });
});

describe('resolveConfigFieldLocale', () => {
  const field = {
    key: 'repository',
    label: 'GitHub repository',
    placeholder: 'owner/repo',
    help: 'Where the desk opens PRs.',
  };

  it('prefers the i18n override for the active locale', () => {
    const i18n = {
      de: {
        config: {
          repository: {
            label: 'GitHub-Repository',
            placeholder: 'owner/repo (DE)',
          },
        },
      },
    };
    const result = resolveConfigFieldLocale(field, i18n, 'de');
    expect(result.label).toBe('GitHub-Repository');
    expect(result.placeholder).toBe('owner/repo (DE)');
    // No DE override for `help` — falls back to the literal.
    expect(result.help).toBe('Where the desk opens PRs.');
  });

  it("prefers the field's own i18n over the manifest config map", () => {
    const withFieldI18n = {
      ...field,
      i18n: { de: { label: 'Feld-Label' } },
    };
    const manifestI18n = {
      de: {
        config: {
          repository: { label: 'Manifest-Label' },
        },
      },
    };
    expect(
      resolveConfigFieldLocale(withFieldI18n, manifestI18n, 'de').label,
    ).toBe('Feld-Label');
  });

  it('falls back to the literal label/placeholder/help with no i18n', () => {
    const result = resolveConfigFieldLocale(field, undefined, 'de');
    expect(result).toEqual({
      label: 'GitHub repository',
      placeholder: 'owner/repo',
      help: 'Where the desk opens PRs.',
    });
  });

  it('humanizes the field key when no literal label is set', () => {
    const bare = { key: 'testCommand' };
    expect(resolveConfigFieldLocale(bare, undefined, 'en').label).toBe(
      'Test Command',
    );
  });

  it('leaves placeholder/help absent (not humanized) when declared nowhere', () => {
    const bare = { key: 'testCommand' };
    const result = resolveConfigFieldLocale(bare, undefined, 'en');
    expect(result.placeholder).toBeUndefined();
    expect(result.help).toBeUndefined();
  });
});
