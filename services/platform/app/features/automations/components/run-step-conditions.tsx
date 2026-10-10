'use client';

import { Badge } from '@tale/ui/badge';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import type { RecordedStep } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import {
  type ConditionVerdict,
  conditionWithValues,
} from '../lib/condition-values';
import { nodeTitle } from '../lib/node-face';

type StepDecision = RecordedStep['decisions'][number];

/** Why the step ran or not, in one sentence; undefined when nothing
 *  decided it. */
function verdictLine(
  step: RecordedStep,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | undefined {
  const name = nodeTitle(step.nodeId);
  const via = step.skip?.via?.[0];
  switch (step.skip?.reason) {
    case 'when':
      return t('conditions.skippedWhen', { step: name });
    case 'else':
      return via === undefined
        ? undefined
        : t('conditions.skippedElse', { step: name, partner: nodeTitle(via) });
    case 'upstream':
      return via === undefined
        ? undefined
        : t('conditions.skippedUpstream', { step: name, via: nodeTitle(via) });
    case 'error':
      return t('conditions.failedContinued', { step: name });
    default:
      break;
  }
  const when = step.decisions.findLast((d) => d.kind === 'when');
  if (when?.kind === 'when' && when.result) {
    return t('conditions.ran', { step: name });
  }
  const otherwise = step.decisions.findLast((d) => d.kind === 'else');
  if (otherwise?.kind === 'else' && otherwise.result) {
    return t('conditions.ranElse', {
      step: name,
      partner: nodeTitle(otherwise.partner),
    });
  }
  return undefined;
}

function VerdictChip({ verdict }: { verdict: ConditionVerdict }) {
  const { t } = useT('automationRuns');
  if (verdict === 'notChecked') {
    return (
      <Badge variant="outline" className="text-muted-foreground shrink-0">
        {t('conditions.verdict.notChecked')}
      </Badge>
    );
  }
  return (
    <Badge
      variant={verdict === 'yes' ? 'green' : 'slate'}
      className="shrink-0 gap-1"
    >
      {verdict === 'yes' ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <Minus className="size-3" aria-hidden="true" />
      )}
      {t(`conditions.verdict.${verdict}`)}
    </Badge>
  );
}

/** One condition the step evaluated: in words with the values it read,
 *  and how it came out — part by part when it is joined. */
function ConditionCard({
  label,
  decision,
}: {
  label: string;
  decision: Extract<StepDecision, { kind: 'when' | 'repeatUntil' }>;
}) {
  const { t } = useT('automationRuns');
  const { t: tAutomations } = useT('automations');
  const { locale } = useLocale();
  const source = decision.source;
  const words =
    source === undefined
      ? null
      : conditionWithValues(source, decision.explanation, decision.result, {
          t: tAutomations,
          locale,
          nodeLabel: nodeTitle,
        });
  let body: ReactNode;
  if (words?.parts !== undefined) {
    body = (
      <>
        <Text as="p" variant="muted" className="text-xs">
          {t(`conditions.joined.${words.parts.joined}`)}
        </Text>
        <ul className="flex flex-col gap-1.5">
          {words.parts.items.map((part, index) => (
            // Parts have no identity beyond their place in the condition.
            <li key={index} className="flex items-start justify-between gap-2">
              <span className="text-sm">
                {part.sentence ?? (
                  <code className="font-mono text-xs">{source}</code>
                )}
              </span>
              <VerdictChip verdict={part.verdict} />
            </li>
          ))}
        </ul>
      </>
    );
  } else if (words?.sentence !== undefined && words.sentence !== null) {
    body = <Text className="text-sm">{words.sentence}</Text>;
  } else {
    body = (
      <>
        <Text variant="muted" className="text-xs">
          {t('conditions.raw')}
        </Text>
        {source !== undefined && (
          <code className="font-mono text-xs break-words">{source}</code>
        )}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Text as="span" className="text-xs font-medium">
          {label}
        </Text>
        {words?.parts === undefined && (
          <VerdictChip verdict={decision.result ? 'yes' : 'no'} />
        )}
      </div>
      {body}
    </div>
  );
}

/**
 * Why a step of a run ran, or did not: a sentence saying so, then each
 * condition it evaluated in words, with the values it read and how it came
 * out.
 */
export function RunStepConditions({ step }: { step: RecordedStep }) {
  const { t } = useT('automationRuns');
  const line = verdictLine(step, t);
  const when = step.decisions.findLast((d) => d.kind === 'when');
  const repeat = step.decisions.findLast((d) => d.kind === 'repeatUntil');
  if (line === undefined && when === undefined && repeat === undefined) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {line !== undefined && (
        <Text as="p" className="text-sm font-medium">
          {line}
        </Text>
      )}
      {when?.kind === 'when' && (
        <ConditionCard label={t('conditions.onlyIf')} decision={when} />
      )}
      {repeat?.kind === 'repeatUntil' && (
        <ConditionCard label={t('conditions.repeatUntil')} decision={repeat} />
      )}
    </div>
  );
}
