import type { FilterConfig } from '@tale/ui/data-table/data-table-filters';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import {
  SECRET_KINDS,
  type SecretKind,
  type SecretSummary,
} from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import type { SecretsFilterChip } from '../components/secrets-filter-chips';
import { NO_FILTERS, type SecretsFilters } from '../lib/filters';
import { KIND_ICONS } from '../lib/kinds';
import { SCOPE_ALL, SCOPE_GLOBAL } from '../lib/scope';
import {
  mergeSessionChoices,
  type SessionChoice,
} from '../lib/session-choices';
import { useSecretLabels } from './use-secret-labels';

interface UseSecretsFiltersOptions {
  /** Every secret there is, not only those the filters leave: the choices come from all of them. */
  rows: readonly SecretSummary[] | undefined;
  filters: SecretsFilters;
  onFiltersChange: (filters: SecretsFilters) => void;
}

/** The kind a choice of the panel names, else every kind. */
function kindOf(value: string | undefined): SecretKind | 'all' {
  return SECRET_KINDS.find((kind) => kind === value) ?? 'all';
}

/**
 * The filters of the list in the shape of Tale's Filter button: one group for
 * the type and one for who the secrets are available to, each a single choice
 * with "all" as the resting one, and the chips of the filters in force.
 *
 * The sessions offered are those a secret is for: they are in the list the page
 * holds already, so the choice is whole (no request, no cap), and a session
 * with no secret, which would show an empty list, is not a choice. The search
 * finds a session by its name for whoever wants to look for one.
 */
export function useSecretsFilters({
  rows,
  filters,
  onFiltersChange,
}: UseSecretsFiltersOptions) {
  const { t } = useT('secrets');
  const labels = useSecretLabels();

  // What was last asked for, which is ahead of what is drawn while the page
  // changes its address: "Clear all" lifts the type and the session one after
  // the other in one click, and the second must not start from the page as it
  // was before the first.
  const latest = useRef(filters);
  useLayoutEffect(() => {
    latest.current = filters;
  });
  const change = useCallback(
    (patch: Partial<SecretsFilters>) => {
      latest.current = { ...latest.current, ...patch };
      onFiltersChange(latest.current);
    },
    [onFiltersChange],
  );
  const clear = useCallback(() => change(NO_FILTERS), [change]);

  const sessions = useMemo(() => {
    const named: SessionChoice[] = [];
    for (const secret of rows ?? []) {
      if (secret.session !== null) {
        named.push({ id: secret.session.id, name: secret.session.name });
      }
    }
    return mergeSessionChoices(named);
  }, [rows]);

  const scopeName = useCallback(
    (scope: string) => {
      if (scope === SCOPE_GLOBAL) return t('scope.everySession');
      const known = sessions.find((session) => String(session.id) === scope);
      return t('scope.session', { name: known?.name ?? scope });
    },
    [sessions, t],
  );

  const configs = useMemo<FilterConfig[]>(() => {
    const scopes = [
      { value: SCOPE_ALL, label: t('scope.all') },
      { value: SCOPE_GLOBAL, label: t('scope.global') },
      ...sessions.map((session) => ({
        value: String(session.id),
        label: t('scope.session', { name: session.name }),
      })),
    ];
    // A session the address names, which no secret is for (any more), is still
    // the choice: it is shown by its number, so the filter in force is seen.
    if (!scopes.some((option) => option.value === filters.scope)) {
      scopes.push({ value: filters.scope, label: scopeName(filters.scope) });
    }
    return [
      {
        key: 'type',
        title: t('filters.type'),
        options: [
          { value: 'all', label: t('filters.all') },
          ...SECRET_KINDS.map((kind) => ({
            value: kind,
            label: labels.kind(kind),
          })),
        ],
        selectedValues: [filters.kind],
        defaultValues: ['all'],
        onChange: (values) => change({ kind: kindOf(values[0]) }),
      },
      {
        key: 'scope',
        title: t('filters.scope'),
        options: scopes,
        selectedValues: [filters.scope],
        defaultValues: [SCOPE_ALL],
        onChange: (values) => change({ scope: values[0] ?? SCOPE_ALL }),
      },
    ];
  }, [t, labels, sessions, filters, scopeName, change]);

  const chips = useMemo<SecretsFilterChip[]>(() => {
    const type: SecretsFilterChip[] =
      filters.kind === 'all'
        ? []
        : [
            {
              key: 'type',
              icon: KIND_ICONS[filters.kind],
              filter: t('filters.type'),
              value: labels.kind(filters.kind),
              onRemove: () => change({ kind: 'all' }),
            },
          ];
    const scope: SecretsFilterChip[] =
      filters.scope === SCOPE_ALL
        ? []
        : [
            {
              key: 'scope',
              filter: t('filters.scope'),
              value: scopeName(filters.scope),
              onRemove: () => change({ scope: SCOPE_ALL }),
            },
          ];
    return [...type, ...scope];
  }, [t, labels, filters, scopeName, change]);

  return { configs, chips, clear };
}
