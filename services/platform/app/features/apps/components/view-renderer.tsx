'use client';

/**
 * The generic view renderer — the heart of the configurable UI. Given a
 * pack-authored view config, it renders each PART by resolving its data-source
 * (reactive) and handing the result to the matching render-kind in the shared
 * part envelope. The page is composed by the CONFIG, never by a workflow's
 * steps. Render-kinds + data-sources are both closed vocabularies, so this is
 * config-driven yet bounded.
 */
import { Grid, VStack } from '@tale/ui/layout';

import { PartEnvelope } from '@/app/features/operator/components/part-envelope';
import { RenderKindRouter } from '@/app/features/operator/components/render-kind-router';
import type { RenderPart } from '@/app/features/operator/types';
import { useT } from '@/lib/i18n/client';
import { isRenderKind } from '@/lib/shared/platform/render_kinds';
import type { ViewConfig, ViewPart } from '@/lib/shared/schemas/views';

import { useDataSource } from '../hooks/use-data-source';

function PartRenderer({
  part,
  organizationId,
}: {
  part: ViewPart;
  organizationId: string;
}) {
  const { t } = useT('operator');
  const resolved = useDataSource(part.source, organizationId);

  // Graceful degradation: an unknown render-kind falls back to `status`.
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
  const parts = view.parts.map((part) => (
    <PartRenderer key={part.id} part={part} organizationId={organizationId} />
  ));

  if (view.layout === 'grid') {
    return <Grid className="grid-cols-1 gap-4 lg:grid-cols-2">{parts}</Grid>;
  }
  return <VStack gap={4}>{parts}</VStack>;
}
