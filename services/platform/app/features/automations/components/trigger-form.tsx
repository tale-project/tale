'use client';

import type {
  TriggerKind,
  TriggerView,
} from '@tale/shared/schemas/automation-trigger';
import { Alert } from '@tale/ui/alert';
import { RadioGroup } from '@tale/ui/radio-group';
import { Select } from '@tale/ui/select';
import { useSwapFade } from '@tale/ui/use-swap-fade';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import type { TriggerDraft } from '../lib/trigger-draft';
import { TriggerEventField } from './trigger-event-field';
import {
  type ScheduleRunState,
  TriggerScheduleField,
  type TriggerSurface,
} from './trigger-schedule-field';

const TRIGGER_KINDS = [
  'schedule',
  'webhook',
  'event',
] as const satisfies readonly TriggerKind[];

function isTriggerKind(value: string): value is TriggerKind {
  return (TRIGGER_KINDS as readonly string[]).includes(value);
}

/**
 * What starts an automation, as one form: the kind, and the kind's own
 * fields. The General tab (`surface="panel"`) and the Blank wizard
 * (`surface="wizard"`) both edit a trigger through it, so they offer the
 * same schedules and refuse the same drafts. What only a stored trigger
 * has — its webhook addresses, its runs — the panel passes in.
 */
export function TriggerForm({
  surface,
  draft,
  stored,
  canEdit,
  viewerZone,
  runState,
  onChange,
  webhookDetails,
  scheduleFieldId,
  installedIn,
  after,
}: {
  surface: TriggerSurface;
  draft: TriggerDraft;
  stored: TriggerView | null;
  canEdit: boolean;
  viewerZone: string;
  runState: ScheduleRunState;
  onChange: (patch: Partial<TriggerDraft>) => void;
  /** The panel's webhook block; the wizard says the URL comes after. */
  webhookDetails?: ReactNode;
  /** The id the schedule's control carries. */
  scheduleFieldId?: string;
  /** The names of the projects the automation is installed in (none: the
   * organization's); undefined while unknown. An event trigger says which
   * events reach it. */
  installedIn?: readonly string[] | undefined;
  /** What follows the kind's fields: the fixed input and what a run
   * receives. */
  after?: ReactNode;
}) {
  const { t } = useT('automations');
  const fadeRef = useSwapFade<HTMLDivElement>(draft.kind, { fromEmpty: false });
  const wizard = surface === 'wizard';

  const kindLabel = (kind: TriggerKind): string => {
    switch (kind) {
      case 'schedule':
        return t('trigger.kinds.schedule');
      case 'webhook':
        return t('trigger.kinds.webhook');
      case 'event':
        return t('trigger.kinds.event');
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  };
  const kindHint = (kind: TriggerKind): string => {
    switch (kind) {
      case 'schedule':
        return t('trigger.kindHint.schedule');
      case 'webhook':
        return t('trigger.kindHint.webhook');
      case 'event':
        return t('trigger.kindHint.event');
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  };
  const setKind = (value: string) => {
    if (isTriggerKind(value)) onChange({ kind: value });
  };

  return (
    <div className="flex flex-col gap-4">
      {wizard ? (
        <RadioGroup
          label={t('blank.kindQuestion')}
          value={draft.kind}
          onValueChange={setKind}
          options={TRIGGER_KINDS.map((value) => ({
            value,
            label: kindLabel(value),
            description: kindHint(value),
          }))}
          disabled={!canEdit}
        />
      ) : (
        <Select
          label={t('trigger.kindLabel')}
          options={TRIGGER_KINDS.map((value) => ({
            value,
            label: kindLabel(value),
          }))}
          value={draft.kind}
          onValueChange={setKind}
          disabled={!canEdit}
          className="min-w-0"
        />
      )}
      <div ref={fadeRef} className="flex flex-col gap-4">
        {draft.kind === 'schedule' && (
          <TriggerScheduleField
            surface={surface}
            draft={draft}
            stored={stored}
            canEdit={canEdit}
            viewerZone={viewerZone}
            enabled={draft.enabled}
            runState={runState}
            onChange={onChange}
            {...(scheduleFieldId !== undefined && { fieldId: scheduleFieldId })}
          />
        )}
        {draft.kind === 'event' && (
          <TriggerEventField
            value={draft.event}
            onChange={(event) => onChange({ event })}
            canEdit={canEdit}
            modal={wizard}
            installedIn={installedIn}
          />
        )}
        {draft.kind === 'webhook' &&
          (wizard ? (
            <Alert variant="info" description={t('blank.webhookHint')} />
          ) : (
            webhookDetails
          ))}
      </div>
      {after}
    </div>
  );
}
