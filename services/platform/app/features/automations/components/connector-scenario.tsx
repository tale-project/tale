'use client';

import type { ConnectorScenarioKind } from '@tale/shared/schemas/connectors';
import { Badge } from '@tale/ui/badge';

import { useT } from '@/lib/i18n/client';

import type { NodeTypeSummary } from '../hooks/backend';

type T = ReturnType<typeof useT>['t'];

/** One case a connector action ships, which a test picks for a node
 * (`scenarios: {<node>: <name>}`), as the editor's catalog lists it. */
export type ConnectorScenarioSummary = NonNullable<
  NodeTypeSummary['scenarios']
>[number];

const KIND_WORDS: Record<ConnectorScenarioKind, (t: T) => string> = {
  success: (t) => t('connectorScenario.kind.success'),
  empty: (t) => t('connectorScenario.kind.empty'),
  error: (t) => t('connectorScenario.kind.error'),
  refusal: (t) => t('connectorScenario.kind.refusal'),
  duplicate: (t) => t('connectorScenario.kind.duplicate'),
};

function isKnownKind(kind: string): kind is ConnectorScenarioKind {
  return Object.hasOwn(KIND_WORDS, kind);
}

/** A scenario's kind in the reader's words; a kind a newer server sends
 * shows as written. */
export function scenarioKindWord(kind: string, t: T): string {
  return isKnownKind(kind) ? KIND_WORDS[kind](t) : kind;
}

/** A scenario's kind as a label beside its name. */
export function ScenarioKindBadge({ kind }: { kind: string }) {
  const { t } = useT('automations');
  return <Badge variant="outline">{scenarioKindWord(kind, t)}</Badge>;
}

/** Which calls the scenario answers: only those whose input carries each
 * member of its `when`, equal as JSON; none when it answers every call. */
export function scenarioWhenText(
  scenario: ConnectorScenarioSummary,
  t: T,
): string | undefined {
  const members = Object.entries(scenario.when ?? {});
  if (members.length === 0) return undefined;
  return t('connectorScenario.when', {
    members: members
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', '),
  });
}

/** What the scenario is and which calls it answers, in one text. */
export function scenarioSummaryText(
  scenario: ConnectorScenarioSummary,
  t: T,
): string {
  const when = scenarioWhenText(scenario, t);
  return when === undefined
    ? scenario.description
    : `${scenario.description} ${when}`;
}
