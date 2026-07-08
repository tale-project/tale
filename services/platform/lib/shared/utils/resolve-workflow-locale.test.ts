import { describe, expect, it } from 'vitest';

import {
  hasWorkflowStepI18n,
  resolveWorkflowStepText,
} from './resolve-workflow-locale';

describe('resolveWorkflowStepText', () => {
  it('returns i18n[locale] name/description when present', () => {
    const step = {
      name: 'List open GitHub issues',
      i18n: {
        de: {
          name: 'Offene GitHub-Issues auflisten',
          description: 'DE description',
        },
      },
    };
    expect(resolveWorkflowStepText(step, 'de')).toEqual({
      name: 'Offene GitHub-Issues auflisten',
      description: 'DE description',
    });
  });

  it('narrows de-CH to i18n.de when only de is populated', () => {
    const step = { name: 'Score', i18n: { de: { name: 'Bewerten' } } };
    expect(resolveWorkflowStepText(step, 'de-CH').name).toBe('Bewerten');
  });

  it('prefers a direct locale match over its narrowed base', () => {
    const step = {
      name: 'Score',
      i18n: { de: { name: 'Bewerten' }, 'de-CH': { name: 'Schwiizerdütsch' } },
    };
    expect(resolveWorkflowStepText(step, 'de-CH').name).toBe('Schwiizerdütsch');
  });

  it('falls back to i18n.en for an unrelated locale, never i18n.de', () => {
    const step = {
      name: 'Score',
      i18n: { en: { name: 'EN name' }, de: { name: 'DE name' } },
    };
    expect(resolveWorkflowStepText(step, 'es').name).toBe('EN name');
  });

  it('falls back to the literal name when i18n has no entry for the field', () => {
    const step = {
      name: 'Top-level name',
      description: 'Top-level description',
      i18n: { de: { name: 'DE name' } }, // no de description
    };
    const result = resolveWorkflowStepText(step, 'de');
    expect(result.name).toBe('DE name');
    expect(result.description).toBe('Top-level description');
  });

  it('resolves a step with no i18n block to its literal name/description', () => {
    const step = { name: 'Legacy', description: 'Legacy description' };
    expect(resolveWorkflowStepText(step, 'de')).toEqual({
      name: 'Legacy',
      description: 'Legacy description',
    });
  });

  it('leaves description undefined when absent everywhere (no hard fallback)', () => {
    const step = { name: 'Score' };
    expect(resolveWorkflowStepText(step, 'en')).toEqual({
      name: 'Score',
      description: undefined,
    });
  });

  it('skips an empty-string i18n override to the next layer', () => {
    const step = { name: 'Top', i18n: { en: { name: '' } } };
    expect(resolveWorkflowStepText(step, 'en').name).toBe('Top');
  });
});

describe('hasWorkflowStepI18n', () => {
  it('is false when the step has no i18n block', () => {
    expect(hasWorkflowStepI18n({})).toBe(false);
  });

  it('is false for an empty i18n object', () => {
    expect(hasWorkflowStepI18n({ i18n: {} })).toBe(false);
  });

  it('is true once any locale entry is present', () => {
    expect(hasWorkflowStepI18n({ i18n: { de: { name: 'x' } } })).toBe(true);
  });
});
