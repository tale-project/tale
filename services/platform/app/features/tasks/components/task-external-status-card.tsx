'use client';

import {
  externalStatusRequestValues,
  type ExternalStatusAction,
} from '@tale/shared/schemas/task-external-status';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useRef, useState, type RefObject } from 'react';

import {
  SettingsFieldControl,
  useLocalized,
} from '@/app/features/automations/components/settings-field-control';
import { fieldIssue } from '@/app/features/automations/hooks/use-settings-editor';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { TaskStatusSnapshot } from '@/backend/domains/tasks/external-status';
import { useT } from '@/lib/i18n/client';

interface OpenSourceForm {
  action: ExternalStatusAction;
  expectedRevision: string;
  expectedSourceRevision: string;
  requestId: string;
}

/** The source declares its business transitions and validates the result.
 * Keeping the displayed declaration and both versions frozen while editing
 * prevents a background refresh from submitting different defaults silently. */
function SourceActionForm({
  form,
  organizationId,
  taskId,
  onClose,
  restoreFocusRef,
}: {
  form: OpenSourceForm;
  organizationId: string;
  taskId: string;
  onClose: () => void;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useT('tasks');
  const localized = useLocalized();
  const actionText = localized(form.action);
  const mutation = useBackendMutation('tasks/mutations:requestExternalStatus', {
    errorToast: false,
  });
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      form.action.fields.map((field) => [
        field.key,
        field.default ?? (field.type === 'boolean' ? 'false' : ''),
      ]),
    ),
  );
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const declaration = {
    ...form.action,
    file: `source-${taskId}-${form.action.id}`,
  };
  const submit = async () => {
    setAttempted(true);
    const firstInvalid = form.action.fields.find(
      (field) => fieldIssue(field, values[field.key] ?? '') !== null,
    );
    if (firstInvalid !== undefined) {
      document
        .getElementById(
          `automation-settings-${declaration.file}-${firstInvalid.key}`,
        )
        ?.focus();
      return;
    }
    try {
      externalStatusRequestValues(form.action, values);
    } catch {
      setError(t('sourceStatus.invalidFields'));
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({
        organizationId,
        taskId,
        requestId: form.requestId,
        expectedRevision: form.expectedRevision,
        expectedSourceRevision: form.expectedSourceRevision,
        actionId: form.action.id,
        values,
      });
      onClose();
    } catch (failure) {
      setError(failureDetail(failure) ?? t('sourceStatus.submitFailed'));
    }
  };
  return (
    <ConfirmDialog
      open
      title={actionText.title}
      description={actionText.description ?? t('sourceStatus.explanation')}
      confirmText={t('sourceStatus.submit')}
      isLoading={mutation.isPending}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
      onConfirm={() => void submit()}
      restoreFocusRef={restoreFocusRef}
    >
      <Stack gap={4}>
        {form.action.fields.map((field) => (
          <SettingsFieldControl
            key={field.key}
            form={declaration}
            field={field}
            value={values[field.key] ?? ''}
            issue={
              attempted ? fieldIssue(field, values[field.key] ?? '') : null
            }
            disabled={mutation.isPending}
            multiline={field.multiline}
            maxLength={4000}
            onChange={(value) =>
              setValues((previous) => ({ ...previous, [field.key]: value }))
            }
          />
        ))}
        {error !== null && <Alert variant="destructive" description={error} />}
      </Stack>
    </ConfirmDialog>
  );
}

function SourceStatusActions({
  snapshot,
  organizationId,
  taskId,
  canWork,
}: {
  snapshot: TaskStatusSnapshot;
  organizationId: string;
  taskId: string;
  canWork: boolean;
}) {
  const { t } = useT('tasks');
  const localized = useLocalized();
  const [form, setForm] = useState<OpenSourceForm | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pending =
    snapshot.request !== null && snapshot.request.decision === null;
  const lastDecision = snapshot.request?.decision;
  const sourceRevision = snapshot.externalStatus?.sourceRevision;
  return (
    <Card asChild padding="md">
      <section
        aria-label={t('sourceStatus.heading')}
        className="flex min-w-0 flex-col gap-3"
      >
        <Text as="h3" variant="label" ref={headingRef} tabIndex={-1}>
          {t('sourceStatus.heading')}
        </Text>
        <Text as="p" variant="muted" className="text-sm">
          {t('sourceStatus.explanation')}
        </Text>
        {pending && (
          <Alert variant="info" description={t('sourceStatus.pending')} />
        )}
        {lastDecision != null && (
          <Alert
            variant={lastDecision.accepted ? 'success' : 'warning'}
            description={
              lastDecision.reason ??
              t(
                lastDecision.accepted
                  ? 'sourceStatus.accepted'
                  : 'sourceStatus.refused',
              )
            }
          />
        )}
        {canWork && sourceRevision !== undefined && (
          <div className="flex flex-wrap gap-2">
            {snapshot.workflow?.actions.map((action) => (
              <Button
                key={action.id}
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  setForm({
                    action,
                    expectedRevision: snapshot.revision,
                    expectedSourceRevision: sourceRevision,
                    requestId: crypto.randomUUID(),
                  })
                }
              >
                {localized(action).title}
              </Button>
            ))}
          </div>
        )}
        {form !== null && (
          <SourceActionForm
            key={form.requestId}
            form={form}
            organizationId={organizationId}
            taskId={taskId}
            onClose={() => setForm(null)}
            restoreFocusRef={headingRef}
          />
        )}
      </section>
    </Card>
  );
}

export function TaskExternalStatusCard({
  organizationId,
  taskId,
  externalSystem,
  canWork,
}: {
  organizationId: string;
  taskId: string;
  externalSystem?: string;
  canWork: boolean;
}) {
  const { t } = useT('tasks');
  const eligible =
    externalSystem !== undefined &&
    !['github', 'glitchtip'].includes(externalSystem.toLowerCase());
  const query = useBackendQuery(
    'tasks/queries:getExternalStatus',
    eligible ? { organizationId, taskId } : 'skip',
  );
  if (!eligible) return null;
  if (query.isError)
    return (
      <Alert variant="destructive" description={t('sourceStatus.loadFailed')}>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('sourceStatus.retry')}
        </Button>
      </Alert>
    );
  if (query.data?.workflow == null) return null;
  return (
    <SourceStatusActions
      key={taskId}
      snapshot={query.data}
      organizationId={organizationId}
      taskId={taskId}
      canWork={canWork}
    />
  );
}
