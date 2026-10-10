'use client';

import {
  useRegisterDirtySource,
  useRegisterGroupedEditor,
  type EditorController,
} from '@tale/ui/editor';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../hooks/backend';
import { useSetApprovalAllowances } from '../hooks/mutations';
import { useApprovalAllowances, useNodeTypeCatalog } from '../hooks/queries';
import { ALLOWANCES_DIRTY_KEY } from '../lib/dirty-keys';
import { automationErrorMessage } from '../lib/errors';
import { actionTitle, connectorName, nodeCatalogView } from '../lib/node-face';

const NO_DIRTY_KEYS: ReadonlySet<string> = new Set();
const ALLOWANCES_DIRTY_KEYS: ReadonlySet<string> = new Set([
  ALLOWANCES_DIRTY_KEY,
]);

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((type) => b.has(type));
}

/**
 * The writes the automation may make without a person approving each run —
 * one switch per write action a step of its latest version makes, and per
 * allowance no step makes any more. On, a live run makes that write
 * straight away; a rule of the organization's approval policy that
 * requires a person still wins. Only an owner or admin changes them; a
 * developer sees them read-only.
 *
 * A section of the automation's General tab: its edits join the page's one
 * Save/Discard cluster, and leaving the tab with unsaved switches asks
 * first.
 */
export function ApprovalAllowancesSection({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const { formatDate } = useFormatDate();
  const query = useApprovalAllowances(organizationId, name);
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const setAllowances = useSetApprovalAllowances();
  const canGrant = query.data?.canGrant === true;
  const actions = useMemo(() => query.data?.actions ?? [], [query.data]);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data],
  );

  const stored = useMemo(
    () =>
      new Set(
        actions
          .filter((action) => action.allowance !== null)
          .map((action) => action.type),
      ),
    [actions],
  );
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set());
  // The rows are the truth; local state carries only unsaved switches,
  // reloaded whenever the stored set itself changes.
  const storedKey = [...stored].sort().join(',');
  const storedRef = useRef(stored);
  storedRef.current = stored;
  useEffect(() => {
    setAllowed(new Set(storedRef.current));
  }, [storedKey]);

  const dirty = !sameSet(allowed, stored);
  const persist = async (): Promise<void> => {
    try {
      await setAllowances.mutateAsync({
        organizationId,
        name,
        allowed: [...allowed],
      });
    } catch (error) {
      throw new Error(automationErrorMessage(error), { cause: error });
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const controller = useMemo<EditorController>(
    () => ({
      isDirty: dirty,
      isSaving: setAllowances.isPending,
      isValid: true,
      isLoading: query.isPending,
      dirtyKeys: dirty ? ALLOWANCES_DIRTY_KEYS : NO_DIRTY_KEYS,
      save: () => persistRef.current(),
      reset: () => {
        setAllowed(new Set(storedRef.current));
      },
    }),
    [dirty, setAllowances.isPending, query.isPending],
  );
  useRegisterGroupedEditor(controller, { enabled: canGrant });
  useRegisterDirtySource(canGrant && dirty);

  const label = (type: string): string => {
    const dot = type.indexOf('.');
    return t('allowances.action', {
      connector: connectorName(type.slice(0, dot), catalog, locale),
      action: actionTitle(type, catalog, locale),
    });
  };
  const description = (action: (typeof actions)[number]): string => {
    const words: string[] = [];
    if (action.allowance !== null && allowed.has(action.type)) {
      words.push(
        t('allowances.grantedBy', {
          name: action.allowance.grantedByName ?? t('allowances.formerMember'),
          date: formatDate(new Date(action.allowance.grantedAt), 'medium'),
        }),
      );
    } else if (!allowed.has(action.type)) {
      words.push(t('allowances.asks'));
    }
    if (!action.used) words.push(t('allowances.unused'));
    return words.join(' ');
  };

  return (
    <Skeletonize loading={query.isPending} label={t('allowances.title')}>
      <SettingsSection
        title={t('allowances.title')}
        description={t('allowances.hint')}
      >
        {actions.length === 0 ? (
          <Text as="p" variant="muted" className="text-sm italic">
            {t('allowances.none')}
          </Text>
        ) : (
          <>
            {actions.map((action) => (
              <SettingsToggleRow
                key={action.type}
                label={label(action.type)}
                description={description(action)}
                checked={allowed.has(action.type)}
                disabled={!canGrant}
                ariaBusy={setAllowances.isPending}
                onCheckedChange={(next) => {
                  setAllowed((current) => {
                    const updated = new Set(current);
                    if (next) updated.add(action.type);
                    else updated.delete(action.type);
                    return updated;
                  });
                }}
              />
            ))}
            {!canGrant && (
              <Text as="p" variant="muted" className="text-xs">
                {t('allowances.readOnly')}
              </Text>
            )}
          </>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
