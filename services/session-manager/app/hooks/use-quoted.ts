import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';
import { i18n } from '@/lib/i18n/i18n';

/**
 * How the names of sessions stand in a sentence: each one quoted the way the
 * language quotes, and several joined the way it lists ("A", "B", and "C").
 */
export function useQuoted() {
  const { t } = useT('sessions');
  const quoted = useCallback(
    (name: string) => t('quoted', { text: name }),
    [t],
  );
  const quotedList = useCallback(
    (names: readonly string[]) =>
      new Intl.ListFormat(i18n.language, {
        style: 'long',
        type: 'conjunction',
      }).format(names.map(quoted)),
    [quoted],
  );
  return { quoted, quotedList };
}
