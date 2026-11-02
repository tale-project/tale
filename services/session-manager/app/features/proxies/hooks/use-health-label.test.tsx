import { afterEach, describe, expect, it } from 'vitest';

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderHookApp } from '@/tests/utils/render';

import { useHealthLabel } from './use-health-label';

afterEach(resetLanguage);

const STATUSES = ['ok', 'failed', 'checking', 'unchecked'] as const;

describe('useHealthLabel', () => {
  it('words each state of a check, with no ellipsis: a status is not a message in progress', () => {
    const { result } = renderHookApp(() => useHealthLabel());

    expect(STATUSES.map((status) => result.current(status))).toEqual([
      'Working',
      'Not working',
      'Checking',
      'Not checked',
    ]);
  });

  it.each([
    [
      'de',
      ['Funktioniert', 'Funktioniert nicht', 'Wird geprüft', 'Nicht geprüft'],
    ],
    ['fr', ['Fonctionne', 'Ne fonctionne pas', 'Vérification', 'Non vérifié']],
  ] as const)('speaks %s', async (language, words) => {
    await showLanguage(language);
    const { result } = renderHookApp(() => useHealthLabel());

    expect(STATUSES.map((status) => result.current(status))).toEqual(words);
  });
});
