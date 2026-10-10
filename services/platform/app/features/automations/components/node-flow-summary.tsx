'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useId } from 'react';

import type { FlowFacts, PathSkip } from '@/lib/engine/core/analysis/flow';
import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { nodeTitle } from '../lib/node-face';
import { failureReasonWords } from '../lib/paths';

export interface NodeFlowSummaryProps {
  node: NodeDef;
  /** The document's flow facts; null on a reference cycle. */
  flow: FlowFacts | null;
  /** Why the node can fail, as the draft check named it. */
  failureReasons?: readonly string[];
  /** How many nodes read this node's output. */
  readerCount: number;
  /** The sentences of the marks on the node's box: it writes, it may ask. */
  marks?: readonly string[];
}

type Translate = ReturnType<typeof useT>['t'];

function skipSentence(skip: PathSkip, node: NodeDef, t: Translate): string {
  if (skip.reason === 'when') return t('editor.flow.skipWhen');
  if (skip.reason === 'else') {
    return t('editor.flow.skipElse', { node: nodeTitle(node.elseOf ?? '') });
  }
  if (skip.reason === 'upstream') {
    return t('editor.flow.skipUpstream', { node: nodeTitle(skip.via ?? '') });
  }
  return t('editor.flow.skipError');
}

/** How often the node runs: always, on some paths, or never. */
function reachSentence(
  flow: FlowFacts,
  id: string,
  t: Translate,
): string | null {
  const reach = flow.reach(id);
  if (!reach.ran) return t('editor.flow.never');
  if (reach.always) return t('editor.flow.always');
  // Too many conditions to list the paths: no count to give.
  if (flow.truncated || flow.paths.length === 0) return null;
  return t('editor.flow.some', {
    count: flow.pathsWhere((path) => path.ran.includes(id)).length,
    total: flow.paths.length,
  });
}

/**
 * "When it runs": how often the node runs, each way it can be skipped,
 * what happens when it fails and why it can — worked out in the browser
 * from the document's conditions, with the draft check's failure reasons
 * once it answered.
 */
export function NodeFlowSummary({
  node,
  flow,
  failureReasons,
  readerCount,
  marks = [],
}: NodeFlowSummaryProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const titleId = useId();
  const lines: string[] = [];
  if (flow !== null) {
    const reach = reachSentence(flow, node.id, t);
    if (reach !== null) lines.push(reach);
    if (flow.reach(node.id).ran) {
      for (const skip of flow.maySkip(node.id)) {
        lines.push(skipSentence(skip, node, t));
      }
    }
  }
  lines.push(
    node.onError === 'continue'
      ? t('editor.flow.failContinues', { count: readerCount })
      : t('editor.flow.failHalts'),
  );
  const reasons = (failureReasons ?? []).flatMap((reason) => {
    const words = failureReasonWords(reason, t);
    return words === null ? [] : [words];
  });
  if (reasons.length > 0) {
    lines.push(
      t('editor.flow.failsWhen', {
        reasons: new Intl.ListFormat(locale, { type: 'disjunction' }).format(
          reasons,
        ),
      }),
    );
  }
  lines.push(...marks);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      <h4 id={titleId} className="text-foreground text-sm font-medium">
        {t('editor.flow.title')}
      </h4>
      <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
        {lines.map((line, index) => (
          // A sentence can repeat (two upstream skips through one node are
          // one line each); the position keeps the keys apart.
          // oxlint-disable-next-line react/no-array-index-key -- the lines are static per render
          <li key={`${index}:${line}`}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
