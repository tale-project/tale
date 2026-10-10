'use client';

import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { Loader2, Power } from 'lucide-react';
import { forwardRef, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Issue } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import { localTimeZone } from '@/lib/shared/zoned-time';

import { useSetAutomationTrigger } from '../hooks/mutations';
import { useAutomationTriggers } from '../hooks/queries';
import { draftFromStored, toTriggerBody } from '../lib/trigger-draft';
import { triggerRefusalText } from '../lib/trigger-issue-text';
import { type TriggerPlace, TriggerSectionLink } from './trigger-links';

/** The trigger a deploy answers with: what now starts the version that
 * runs, and what it would meet in that version. */
export interface DeployedTrigger {
  kind: TriggerView['kind'];
  enabled: boolean;
  nextRunAt: number | null;
  warnings: readonly Issue[];
}

/** The trigger a deploy's answer calls for a notice about — one that is
 * off — or null. */
export function triggerOffAfterDeploy(
  trigger: DeployedTrigger | null | undefined,
): DeployedTrigger | null {
  return trigger != null && !trigger.enabled ? trigger : null;
}

/**
 * Said after a deploy that left the automation's trigger off — a pack's
 * trigger is created off, so nothing starts before someone has looked at
 * it. **Turn on the trigger** saves the stored trigger as it is, switched
 * on, and the notice then says it is on. When the version would refuse
 * what the trigger sends, the action is **Review the trigger** instead,
 * the General tab's trigger section, so a trigger every start of which
 * would be skipped is never armed from here; so is a webhook that has no
 * URL yet, since its URL is shown once, where it is minted.
 *
 * The notice takes no focus on its own; the host hands it focus when the
 * control that deployed leaves the page (`ref` focuses its frame).
 */
export const TriggerDeployNotice = forwardRef<
  HTMLDivElement,
  {
    place: TriggerPlace;
    trigger: DeployedTrigger;
    /** Runs as **Review the trigger** is followed. */
    onReview?: (() => void) | undefined;
  }
>(function TriggerDeployNotice({ place, trigger, onReview }, ref) {
  const { t } = useT('automations');
  const { t: tRecurrence } = useT('recurrence');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const frameRef = useRef<HTMLDivElement | null>(null);
  const setFrame = useCallback(
    (node: HTMLDivElement | null) => {
      frameRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref !== null) ref.current = node;
    },
    [ref],
  );
  const triggers = useAutomationTriggers(place.organizationId, place.name);
  const setTrigger = useSetAutomationTrigger();
  const [turnedOn, setTurnedOn] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Turn on gives way to the status once it worked; the focus it held
  // goes to the notice, which now says the trigger is on.
  const actionRef = useFocusHandoff<HTMLDivElement>(() =>
    frameRef.current?.focus(),
  );

  const stored = triggers.data?.[0];
  const busy = setTrigger.isPending || triggers.isPending;
  // On once this notice turned it on — or once the stored trigger reads
  // on, when someone else did.
  const on = turnedOn || stored?.enabled === true;
  const review =
    trigger.warnings.length > 0 ||
    (stored?.kind === 'webhook' && !stored.hasToken);

  const turnOn = async () => {
    if (stored === undefined) return;
    setFailure(null);
    try {
      // The trigger exactly as it is stored, switched on: a cron stays
      // the same cron, a rule keeps its start date.
      const draft = {
        ...draftFromStored(stored, localTimeZone()),
        enabled: true,
      };
      await setTrigger.mutateAsync({
        organizationId: place.organizationId,
        name: place.name,
        trigger: toTriggerBody(draft, stored),
      });
      setTurnedOn(true);
    } catch (error) {
      // The one report of the refusal, in the store's words.
      setFailure(triggerRefusalText(error, { t, tRecurrence, locale }));
    }
  };

  return (
    <div
      ref={setFrame}
      tabIndex={-1}
      className="animate-fade-in rounded-lg focus-visible:outline-none"
    >
      <Alert
        variant={on ? 'success' : 'info'}
        live="off"
        {...(!on && {
          title: t('trigger.deployNotice.title'),
          description: t('trigger.deployNotice.body', { kind: trigger.kind }),
        })}
      >
        <div role="status" className="text-foreground text-sm">
          {on ? t('trigger.deployNotice.turnedOn') : null}
        </div>
        {!on && (
          <div ref={actionRef} className="flex flex-col items-start gap-2 pt-2">
            {review ? (
              <TriggerSectionLink place={place} onNavigate={onReview}>
                {t('trigger.deployNotice.review')}
              </TriggerSectionLink>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                // Busy, not disabled: a disabled button drops its focus,
                // and the focus is what the notice takes over once on.
                icon={busy ? Loader2 : Power}
                iconClassName={
                  busy ? 'animate-spin motion-reduce:animate-none' : undefined
                }
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                disabled={stored === undefined && !triggers.isPending}
                onClick={busy ? undefined : () => void turnOn()}
              >
                {t('trigger.deployNotice.turnOn')}
              </Button>
            )}
            {triggers.isError && stored === undefined && (
              <Text as="p" role="alert" className="text-destructive text-xs">
                {t('trigger.loadFailed')}
              </Text>
            )}
            {failure !== null && (
              <Text as="p" role="alert" className="text-destructive text-xs">
                {t('trigger.deployNotice.turnOnFailed', { error: failure })}
              </Text>
            )}
          </div>
        )}
      </Alert>
    </div>
  );
});
