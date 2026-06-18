'use client';

/**
 * The generic view renderer — the heart of the configurable UI. Given a
 * pack-authored view config, it renders each PART by resolving its data-source
 * (reactive) and handing the result to the matching render-kind in the shared
 * part envelope, with the part's ACTIONS wired to the audited dispatch registry.
 * The page is composed by the CONFIG — never by a workflow's steps. The `split`
 * layout turns it into a closed-loop master-detail workspace.
 */
import { Grid, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { PartEnvelope } from '@/app/features/operator/components/part-envelope';
import { RenderKindRouter } from '@/app/features/operator/components/render-kind-router';
import type { RenderPart } from '@/app/features/operator/types';
import { useT } from '@/lib/i18n/client';
import { isRenderKind } from '@/lib/shared/platform/render_kinds';
import type { ViewConfig, ViewPart } from '@/lib/shared/schemas/views';

import { type AppActions, useAppActions } from '../hooks/use-action';
import { useDataSource } from '../hooks/use-data-source';

interface ListSelection {
  onSelect: (item: Record<string, unknown>) => void;
  selectedId: string | undefined;
}

function PartRenderer({
  part,
  organizationId,
  actions,
  injected,
  listSelection,
}: {
  part: ViewPart;
  organizationId: string;
  actions: AppActions;
  /** Selected-row values merged into this (detail) part's source params. */
  injected?: Record<string, unknown>;
  /** Present when this part is the LIST of a split view. */
  listSelection?: ListSelection;
}) {
  const { t } = useT('operator');
  const source =
    injected !== undefined
      ? { ...part.source, params: { ...part.source.params, ...injected } }
      : part.source;
  const resolved = useDataSource(source, organizationId);

  const render = isRenderKind(part.render) ? part.render : 'status';
  const fallbackTitle = part.title ?? part.id;
  const renderPart: RenderPart = {
    render,
    partState: resolved.partState,
    title: part.labelKey
      ? t(part.labelKey, { defaultValue: fallbackTitle })
      : fallbackTitle,
    data: resolved.data,
    ...(part.labelKey !== undefined && { labelKey: part.labelKey }),
    ...(part.params !== undefined && { params: part.params }),
    ...(part.actions !== undefined && {
      actions: part.actions,
      onAction: (action, item) => void actions.dispatch(action, item),
      actionsPending: actions.isPending,
    }),
    ...(listSelection !== undefined && {
      onSelect: listSelection.onSelect,
      ...(part.selectionKey !== undefined && {
        selectionKey: part.selectionKey,
      }),
      ...(listSelection.selectedId !== undefined && {
        selectedId: listSelection.selectedId,
      }),
    }),
  };

  return (
    <PartEnvelope part={renderPart}>
      <RenderKindRouter part={renderPart} />
    </PartEnvelope>
  );
}

export function ViewRenderer({
  view,
  organizationId,
}: {
  view: ViewConfig;
  organizationId: string;
}) {
  const { t } = useT('operator');
  const actions = useAppActions(organizationId);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Master-detail: first part = list (left), the rest = detail (right) and
  // rebind to the selected row via the list's selectionKey.
  if (view.layout === 'split' && view.parts.length >= 2) {
    const [list, ...details] = view.parts;
    const selKey = list.selectionKey;
    const injected =
      selKey !== undefined && selectedId !== undefined
        ? { [selKey]: selectedId }
        : undefined;
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <PartRenderer
          part={list}
          organizationId={organizationId}
          actions={actions}
          listSelection={{
            onSelect: (item) =>
              setSelectedId(
                selKey !== undefined ? String(item[selKey]) : undefined,
              ),
            selectedId,
          }}
        />
        <VStack gap={4}>
          {selectedId === undefined ? (
            <Text variant="muted">{t('body.selectItem')}</Text>
          ) : (
            details.map((d) => (
              <PartRenderer
                key={d.id}
                part={d}
                organizationId={organizationId}
                actions={actions}
                injected={injected}
              />
            ))
          )}
        </VStack>
      </div>
    );
  }

  const parts = view.parts.map((part) => (
    <PartRenderer
      key={part.id}
      part={part}
      organizationId={organizationId}
      actions={actions}
    />
  ));

  if (view.layout === 'grid') {
    return <Grid className="grid-cols-1 gap-4 lg:grid-cols-2">{parts}</Grid>;
  }
  return <VStack gap={4}>{parts}</VStack>;
}
