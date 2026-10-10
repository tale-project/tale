'use client';

import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Text } from '@tale/ui/text';
import { Play } from 'lucide-react';
import { useState } from 'react';

import { triggerInputSample } from '@/lib/automations/trigger-input';
import { useT } from '@/lib/i18n/client';

import { useStartAutomationRun } from '../hooks/mutations';
import { automationErrorMessage } from '../lib/errors';
import { AutomationRunDialog } from './automation-run-dialog';
import { type TriggerPlace, TriggerRunLink } from './trigger-links';

/** What a Run now did, said under its button. */
type RunNowOutcome =
  | { kind: 'started'; runId: string }
  | { kind: 'failed'; message: string };

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** The input the stored trigger starts a run with, fired now. */
function storedRunInput(stored: TriggerView): Record<string, unknown> | null {
  return (
    triggerInputSample(
      { kind: stored.kind, event: stored.event, input: stored.input },
      Date.now(),
    )?.input ?? null
  );
}

/**
 * **Run now**: start the live version once with what the stored trigger
 * sends, as the trigger would — same version, same input, same project
 * scope (none named: the store infers a sole binding, as for a trigger).
 * A schedule asks first, showing the input; a webhook or an event opens
 * the run dialog with the sample to edit. Nothing about the trigger moves:
 * the run is yours, so its last start and its schedule stay as they are.
 *
 * It waits for a deployed version and for the trigger's edits to be
 * saved, and says which. What happened is said under the button — the run
 * that started, or why none did — and focus stays where it was.
 */
export function TriggerRunNow({
  place,
  stored,
  deployedVersion,
  inputsSchema,
  dirty,
  scopeText,
}: {
  place: TriggerPlace;
  stored: TriggerView | null;
  deployedVersion: number | undefined;
  /** The deployed version's `inputs`, which the run dialog checks. */
  inputsSchema: Record<string, unknown> | undefined;
  /** The form holds edits the stored trigger does not. */
  dirty: boolean;
  /** Where the run will act, as the live-run dialogs say it. */
  scopeText: string;
}) {
  const { t } = useT('automations');
  const startRun = useStartAutomationRun();
  const [confirmInput, setConfirmInput] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [dialogInput, setDialogInput] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RunNowOutcome | null>(null);

  const disabledReason =
    deployedVersion === undefined
      ? t('detail.runLiveNeedsDeploy')
      : dirty || stored === null
        ? t('trigger.runNow.unsaved')
        : undefined;

  const start = async (
    version: number,
    input: unknown,
    fromDialog: boolean,
  ) => {
    setOutcome(null);
    setDialogError(null);
    try {
      const run = await startRun.mutateAsync({
        organizationId: place.organizationId,
        name: place.name,
        mode: 'live',
        version,
        input,
      });
      setConfirmInput(null);
      setDialogInput(null);
      setOutcome({ kind: 'started', runId: run.runId });
    } catch (error) {
      // The one report of the refusal: the run dialog keeps it beside the
      // input it was refused for; a schedule's confirm closes and says it
      // under the button.
      const message = automationErrorMessage(error);
      if (fromDialog) {
        setDialogError(message);
      } else {
        setConfirmInput(null);
        setOutcome({ kind: 'failed', message });
      }
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        icon={Play}
        isLoading={startRun.isPending}
        disabled={disabledReason !== undefined}
        {...(disabledReason !== undefined && { disabledReason })}
        onClick={() => {
          if (stored === null) return;
          const input = storedRunInput(stored);
          if (input === null) return;
          setOutcome(null);
          if (stored.kind === 'schedule') {
            setConfirmInput(input);
          } else {
            setDialogError(null);
            setDialogInput(input);
          }
        }}
      >
        {t('trigger.runNow.label')}
      </Button>
      {outcome?.kind === 'started' && (
        <Text as="p" role="status" className="text-right text-xs">
          {t('trigger.runNow.started')}{' '}
          <TriggerRunLink place={place} runId={outcome.runId}>
            {t('trigger.failures.viewRun')}
          </TriggerRunLink>
        </Text>
      )}
      {outcome?.kind === 'failed' && (
        <Text
          as="p"
          role="alert"
          className="text-destructive text-right text-xs"
        >
          {t('trigger.runNow.failed', { error: outcome.message })}
        </Text>
      )}

      {deployedVersion !== undefined && (
        <ConfirmDialog
          open={confirmInput !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmInput(null);
          }}
          title={t('detail.runLiveTitle')}
          description={t('trigger.runNow.body', { version: deployedVersion })}
          confirmText={t('trigger.runNow.confirm')}
          isLoading={startRun.isPending}
          onConfirm={() => {
            if (confirmInput !== null) {
              void start(deployedVersion, confirmInput, false);
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <Text as="p" variant="muted" className="text-sm">
              {scopeText}
            </Text>
            {confirmInput !== null && (
              <CodeBlock>{pretty(confirmInput)}</CodeBlock>
            )}
          </div>
        </ConfirmDialog>
      )}

      {deployedVersion !== undefined && dialogInput !== null && (
        <AutomationRunDialog
          request={{
            automationSlug: place.name,
            mode: 'live',
            version: deployedVersion,
            initialInput: dialogInput,
            ...(inputsSchema !== undefined && { schema: inputsSchema }),
            scopeText,
          }}
          pending={startRun.isPending}
          error={dialogError}
          onClose={() => setDialogInput(null)}
          onConfirm={(input) => void start(deployedVersion, input, true)}
        />
      )}
    </div>
  );
}
