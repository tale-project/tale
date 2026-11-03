import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useSessionChoices } from '../hooks/use-session-choices';
import { SCOPE_GLOBAL } from '../lib/scope';
import {
  mergeSessionChoices,
  type SessionChoice,
} from '../lib/session-choices';

interface SecretScopeFieldProps {
  /** `global`, or the id of a session. */
  value: string;
  onValueChange: (scope: string) => void;
  /**
   * Sessions the loaded ones may not include (the one the secret is for, when
   * there are more sessions than one request returns).
   */
  knownSessions?: readonly SessionChoice[];
}

/**
 * Who a secret is for, as a field of the form: every session, or one of them,
 * found by typing. The sessions come from one request that returns the newest
 * 500; a footer says so when there are more, and the session the secret is
 * for is always offered.
 */
export function SecretScopeField({
  value,
  onValueChange,
  knownSessions,
}: SecretScopeFieldProps) {
  const { t } = useT('secrets');
  const choices = useSessionChoices();
  const sessions = useMemo(
    () => mergeSessionChoices(choices.sessions, knownSessions ?? []),
    [choices.sessions, knownSessions],
  );

  const options = useMemo(() => {
    const list: SearchableSelectOption[] = [
      { value: SCOPE_GLOBAL, label: t('scope.everySession'), group: 'scopes' },
    ];
    for (const session of sessions) {
      list.push({
        value: String(session.id),
        label: t('scope.session', { name: session.name }),
        group: 'sessions',
      });
    }
    // A session that is chosen but not known (it is beyond the first 500 and
    // no secret is for it) is still the choice: it is shown by its number.
    if (!list.some((option) => option.value === value)) {
      list.push({
        value,
        label: t('scope.session', { name: value }),
        group: 'sessions',
      });
    }
    return list;
  }, [sessions, value, t]);

  const capped = choices.total > choices.sessions.length;

  // "No session found" says there are none: not what a search finds while the
  // sessions are still on their way, or when they could not be read.
  let emptyText = t('scope.none');
  if (choices.isPending) emptyText = t('scope.loading');
  else if (choices.isError) emptyText = t('scope.loadFailed');

  return (
    <SearchableSelect
      label={t('scope.label')}
      value={value}
      onValueChange={onValueChange}
      options={options}
      searchPlaceholder={t('scope.search')}
      emptyText={emptyText}
      footer={
        capped ? (
          <Text variant="caption" className="px-2 py-1.5">
            {t('scope.capped', {
              count: choices.sessions.length,
              total: choices.total,
            })}
          </Text>
        ) : undefined
      }
      // In a dialog: its list needs the dialog's scroll lock lifted.
      modal
      align="start"
    />
  );
}
