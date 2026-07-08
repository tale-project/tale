import { describe, expect, it } from 'vitest';

import {
  humanizeFieldKey,
  resolveAutomationLocale,
  resolveConfigFieldLocale,
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

  it('drops a trailing legacy "Placeholder" suffix', () => {
    expect(humanizeFieldKey('repoPlaceholder')).toBe('Repo');
  });

  it('handles a bare single-word key', () => {
    expect(humanizeFieldKey('repo')).toBe('Repo');
  });
});

describe('resolveConfigFieldLocale', () => {
  const field = {
    key: 'repository',
    label: 'GitHub repository',
    labelKey: 'config.repo',
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

  it('falls back to the literal label/placeholder/help with no i18n', () => {
    const result = resolveConfigFieldLocale(field, undefined, 'de');
    expect(result).toEqual({
      label: 'GitHub repository',
      placeholder: 'owner/repo',
      help: 'Where the desk opens PRs.',
    });
  });

  it('humanizes the deprecated labelKey when no literal label is set', () => {
    const noLiteral = {
      key: 'repository',
      labelKey: 'config.repo',
    };
    expect(resolveConfigFieldLocale(noLiteral, undefined, 'en').label).toBe(
      'Repo',
    );
  });

  it('humanizes the field key when neither a literal label nor a labelKey is set', () => {
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
