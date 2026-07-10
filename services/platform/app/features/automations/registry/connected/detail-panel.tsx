'use client';

/**
 * Connected `DetailPanel` block — binds an allowlisted query returning ONE
 * record and renders declared fields as the `@tale/ui` StatGrid `<dl>` of
 * label/value pairs. Field `kind` picks the value renderer: `badge` (the
 * shared status→variant map), `datetime` (the platform date formatter, epoch
 * ms or ISO), `link` (a safe external anchor — http(s) only), `number`
 * (locale-aware Intl), default `text`. Works standalone or inside the
 * resource-detail overlay; `actions` render as a `BoundButton` cluster in the
 * frame's actions slot, bound to the loaded record.
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { Badge } from '@tale/ui/badge';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack } from '@tale/ui/layout';
import { StatGrid, type StatGridItem } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { STATUS_VARIANT } from '@/app/components/ui/data-table/cell-kinds';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import {
  argsReferenceProjectId,
  argsReferenceViewState,
} from '@/lib/shared/platform/function_bindings';
import { formatNumber } from '@/lib/utils/format/number';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { BindingStates, BlockFrame } from '../block-frame';
import { BoundButton, type BoundActionSpec } from './bound-button';
import { getValueAtPath } from './stat-grid';

export interface DetailFieldSpec {
  /** Literal display label, rendered verbatim. */
  labelKey: string;
  /** Dot-notation path into the record. */
  field: string;
  kind?: 'text' | 'badge' | 'datetime' | 'link' | 'number';
  /**
   * Optional display map for `badge` values (same contract as Collection
   * columns). Unmapped values still render raw — authors opt in per field.
   */
  valueLabels?: Record<string, string>;
}

export interface DetailPanelProps {
  /** Optional block title (literal; schema passthrough).
   *  Defaults to the localized "Details". */
  title?: string;
  query: { path: string; args?: unknown };
  /** `<dl>` column count (1–4, default 2). */
  cols?: number;
  fields: DetailFieldSpec[];
  actions?: BoundActionSpec[];
  /**
   * Dot-path into the loaded record used as the BoundButton `$selected` item.
   * Use when the query returns an envelope (e.g. `getTask` → `{ task, … }`)
   * so `when` / `$selected._id` match the flat row Collection actions use.
   */
  actionItemField?: string;
  /**
   * Extra controls rendered before BoundButton actions (e.g. a feedback-first
   * Request changes dialog that is not a plain BoundActionSpec).
   */
  actionSlot?: ReactNode;
}

/** Only plain web URLs render as anchors — anything else stays inert text. */
function isSafeExternalUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function DetailValue({
  value,
  kind,
  valueLabels,
}: {
  value: unknown;
  kind: DetailFieldSpec['kind'];
  valueLabels?: Record<string, string>;
}) {
  const { locale } = useLocale();
  const { formatDate } = useFormatDate();

  if (value === null || value === undefined) return <>—</>;

  if (kind === 'badge') {
    const text =
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined;
    if (!text) return <>—</>;
    const label = valueLabels?.[text] ?? text;
    return <Badge variant={STATUS_VARIANT[text] ?? 'slate'}>{label}</Badge>;
  }
  if (kind === 'datetime') {
    const date =
      typeof value === 'number' || typeof value === 'string'
        ? new Date(value)
        : undefined;
    if (!date || Number.isNaN(date.getTime())) return <>—</>;
    return <>{formatDate(date, 'long')}</>;
  }
  if (kind === 'link') {
    if (typeof value !== 'string' || value === '') return <>—</>;
    // Opaque ids (folder / document) are not web links — never dump them as
    // inert text; callers that need a folder name resolve via getFolder.
    if (!isSafeExternalUrl(value)) return <>—</>;
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-primary focus-visible:ring-primary rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {value}
      </a>
    );
  }
  if (kind === 'number') {
    return <>{typeof value === 'number' ? formatNumber(value, locale) : '—'}</>;
  }
  // Default `text` — render scalars, never dump objects.
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return <>{String(value)}</>;
  }
  return <>—</>;
}

export function DetailPanel({
  title,
  query,
  cols,
  fields,
  actions,
  actionItemField,
  actionSlot,
}: DetailPanelProps) {
  const { t } = useT('automations');
  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    query.path,
    query.args,
  );
  const awaitingState = needsConfig && argsReferenceViewState(query.args);
  const needsProject =
    needsConfig && !awaitingState && argsReferenceProjectId(query.args);
  const record = isRecord(data) ? data : undefined;
  const actionItem = (() => {
    if (!record) return undefined;
    if (!actionItemField) return record;
    const nested = getValueAtPath(record, actionItemField);
    return isRecord(nested) ? nested : record;
  })();

  const items: StatGridItem[] = fields.map((f) => ({
    label: f.labelKey,
    value: (
      <DetailValue
        value={getValueAtPath(record, f.field)}
        kind={f.kind}
        valueLabels={f.valueLabels}
      />
    ) as ReactNode,
  }));
  const dlCols =
    cols === 1 || cols === 2 || cols === 3 || cols === 4 ? cols : 2;
  const hasBoundActions = Boolean(actionItem && actions && actions.length > 0);
  const hasActions = Boolean(actionSlot) || hasBoundActions;

  return (
    <BlockFrame
      title={title ?? t('detail.title')}
      icon={Info}
      actions={
        hasActions ? (
          <HStack gap={2}>
            {actionSlot}
            {hasBoundActions
              ? actions?.map((action, i) => (
                  <BoundButton key={i} action={action} item={actionItem} />
                ))
              : null}
          </HStack>
        ) : undefined
      }
    >
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig && !awaitingState && !needsProject}
        needsProject={needsProject}
        awaitingState={awaitingState}
        loading={isLoading && record === undefined}
      >
        {record === undefined ? (
          // A no-access query resolves to null — degrade to the shared empty
          // notice instead of a grid of dashes (or a crash).
          <Text variant="muted">{t('binding.empty')}</Text>
        ) : (
          <StatGrid items={items} cols={dlCols} />
        )}
      </BindingStates>
    </BlockFrame>
  );
}

/** Registry entry (`registerConnectedBlock('DetailPanel', detailPanelBlock)`). */
export const detailPanelBlock: {
  fields: Fields;
  render: PuckComponent<Partial<DetailPanelProps>>;
} = {
  fields: { title: { type: 'text' } },
  render: ({ title, query, cols, fields, actions }) =>
    query?.path && fields && fields.length > 0 ? (
      <DetailPanel
        title={title}
        query={query}
        cols={cols}
        fields={fields}
        actions={actions}
      />
    ) : (
      <></>
    ),
};
