'use client';

import type { FlowRow } from '@tale/ui/flow/types';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import type {
  AnalysisView,
  TypesView,
} from '@/lib/shared/schemas/automation-issues';

import { toFlowGraph, type AutomationFlowGraph } from '../lib/flow-graph';
import type { NodeCatalogView, ReturnsSource } from '../lib/node-face';
import { automationPaths, type AutomationPaths } from '../lib/paths';

export interface CanvasFlowInput {
  automation: Automation;
  catalog: NodeCatalogView;
  modelLabel?: (id: string) => string | undefined;
  /** Start's trigger rows. */
  triggers: readonly FlowRow[];
  /** What the draft check answered, for the reader who may have one. */
  check: {
    status: ReturnsSource['status'];
    analysis: AnalysisView | null;
    types: TypesView | null;
  };
  startNotice?: string | null;
  /** The pinned path's row: End then says what it leaves empty. */
  pinnedPath?: string | null;
}

export interface CanvasFlow extends AutomationFlowGraph {
  /** The Paths list and highlights; null on a reference cycle. */
  paths: AutomationPaths | null;
}

/**
 * The canvas's picture of one document: the graph it draws, the flow
 * analysis behind its conditions and paths, and the Paths list — each
 * worked out once per document and language, in the browser, so every
 * viewer of every version has them at once. The draft check's answer only
 * adds what it alone knows: the shapes each node returns and why a node
 * can fail.
 */
export function useCanvasFlow({
  automation,
  catalog,
  modelLabel,
  triggers,
  check,
  startNotice,
  pinnedPath,
}: CanvasFlowInput): CanvasFlow {
  const { t } = useT('automations');
  const { t: tSchema } = useT('schemaTree');
  const { locale } = useLocale();
  const { nodes } = automation;
  const flow = useMemo(() => analyzeFlow(nodes), [nodes]);
  const outputs = useMemo(
    () =>
      check.types === null
        ? null
        : Object.fromEntries(
            Object.entries(check.types.nodes).map(([id, info]) => [
              id,
              info.output,
            ]),
          ),
    [check.types],
  );
  const context = useMemo(
    () => ({
      t,
      tSchema,
      locale,
      catalog,
      ...(modelLabel !== undefined && { modelLabel }),
      returns: { status: check.status, outputs },
      triggers,
      flow,
      outputShape: check.types?.output ?? null,
      startNotice: startNotice ?? null,
    }),
    [
      t,
      tSchema,
      locale,
      catalog,
      modelLabel,
      check.status,
      outputs,
      triggers,
      flow,
      check.types,
      startNotice,
    ],
  );
  const base = useMemo(
    () => toFlowGraph(automation, context),
    [automation, context],
  );
  const paths = useMemo(() => {
    if (flow === null || base.hasCycle) return null;
    const byId = new Map(automation.nodes.map((node) => [node.id, node]));
    return automationPaths(flow, base.graph, {
      t,
      locale,
      elseOf: (id) => byId.get(id)?.elseOf,
      ...(check.analysis !== null && { halts: check.analysis.paths.halts }),
    });
  }, [flow, base, automation.nodes, t, locale, check.analysis]);
  const ranOnPath = useMemo(
    () =>
      pinnedPath === undefined || pinnedPath === null
        ? null
        : (paths?.ranOn(pinnedPath) ?? null),
    [paths, pinnedPath],
  );
  const shown = useMemo(
    () =>
      ranOnPath === null
        ? base
        : toFlowGraph(automation, { ...context, ranOnPath }),
    [ranOnPath, base, automation, context],
  );
  return { ...shown, paths };
}
