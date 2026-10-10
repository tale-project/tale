'use client';

import type { TriggerKind } from '@tale/shared/schemas/automation-trigger';
import { Alert } from '@tale/ui/alert';
import { CodeBlock } from '@tale/ui/code-block';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Check } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '@/lib/i18n/client';

import type { TriggerInputCheck } from '../hooks/use-trigger-input-check';
import { issueText } from '../lib/issue-text';
import { type TriggerPlace, TriggerEditorLink } from './trigger-links';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * "This run receives": the input the trigger starts a run with — its own
 * fields over the fixed input — what its fields mean, and whether the
 * deployed version takes it. The General tab shows it as a section with
 * **Run now** beside its title (`action`); the Blank wizard, where nothing
 * is deployed yet to check against, folds it away.
 */
export function TriggerInputPreview({
  surface,
  kind,
  check,
  version,
  place,
  action,
}: {
  surface: 'panel' | 'wizard';
  kind: TriggerKind;
  check: TriggerInputCheck;
  /** The deployed version the check read; undefined while none is. */
  version: number | undefined;
  /** Where the section is shown, for its way into the editor. */
  place?: TriggerPlace;
  /** What sits beside the title: Run now. */
  action?: ReactNode;
}) {
  const { t } = useT('automations');
  const { t: tIssues } = useT('automationIssues');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const { formatDate } = useFormatDate();
  const titleId = useId();

  if (check.input === null) return null;

  let note: string;
  switch (kind) {
    case 'schedule':
      note = t('trigger.input.firedAt', {
        at: formatDate(new Date(check.firedAt ?? Date.now()), 'long'),
      });
      break;
    case 'webhook':
      note = t('trigger.input.webhook');
      break;
    case 'event':
      note = t('trigger.input.event');
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }

  const { verdict } = check;
  const notTemplated = check.warnings.filter(
    (warning) => warning.code === 'TRIGGER_INPUT_NOT_TEMPLATED',
  );
  const text = pretty(check.input);

  const body = (
    <div className="flex flex-col gap-2">
      <CodeBlock copyValue={text} copyLabel={t('trigger.input.copy')}>
        {text}
      </CodeBlock>
      <Text as="p" variant="muted" className="text-xs">
        {note}
      </Text>
      {verdict?.kind === 'accepted' && version !== undefined && (
        <Text
          as="p"
          variant="muted"
          className="flex items-center gap-1.5 text-xs"
        >
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
          {t('trigger.input.accepted', { version })}
        </Text>
      )}
      {verdict?.kind === 'refused' && version !== undefined && (
        <Alert
          variant="warning"
          // A standing state of the form, not news.
          live="off"
          title={t('trigger.input.refusedTitle', { version })}
          description={
            <span className="flex flex-col gap-1.5">
              <span>{t('trigger.input.refusedBody')}</span>
              {verdict.paths.length > 0 && (
                <span className="font-mono text-xs break-words">
                  {verdict.paths.join(', ')}
                </span>
              )}
              {place !== undefined && (
                <span>
                  <TriggerEditorLink place={place}>
                    {t('trigger.skip.openEditor')}
                  </TriggerEditorLink>
                </span>
              )}
            </span>
          }
        />
      )}
      {notTemplated.map((warning) => {
        const words = issueText(warning, { locale, t: tIssues });
        return (
          <Alert
            key={`${warning.code}-${words.cause}`}
            variant="warning"
            live="off"
            title={words.title}
            description={`${words.cause} ${words.fix}`.trim()}
          />
        );
      })}
    </div>
  );

  if (surface === 'wizard') {
    return (
      <CollapsibleDetails summary={t('trigger.input.title')}>
        <div className="mt-3">{body}</div>
      </CollapsibleDetails>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="h3" id={titleId} className="text-sm font-medium">
          {t('trigger.input.title')}
        </Text>
        {action}
      </div>
      {body}
    </section>
  );
}
