'use client';

import { Alert } from '@tale/ui/alert';
import { Field } from '@tale/ui/field';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Select } from '@/app/components/ui/forms/select';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useStartBuilderSession } from '../hooks/mutations';
import {
  useBuilderCredentials,
  useBuilderModelCatalog,
} from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import { BuilderOutcomeAlert } from './builder-outcome-alert';

/** The two credential kinds a direct builder model call may use — the
 * subscription flavors are bound to vendor harnesses (see `model_call.ts`). */
const USABLE_AUTH_METHODS = new Set(['api-key', 'env']);

/**
 * "New automation": a goal, a model, and an authoring session.
 *
 * The session is one long action call — minutes, not milliseconds — so the
 * dialog stays open with a progress note while it runs. Closing it loses only
 * the summary: every version the builder saves lands in the reactive listing
 * regardless. On success the dialog navigates to the authored automation; a
 * session that gave up stays open and shows the builder's own reason.
 *
 * Controlled: the trigger lives in the list header's create menu, alongside
 * the upload lane's.
 */
export function NewAutomationDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  /** Author into one project's surface (links stay inside the project shell). */
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const goalId = useId();
  const navigate = useNavigate();
  const [goal, setGoal] = useState('');
  const [providerSlug, setProviderSlug] = useState('');
  const [modelId, setModelId] = useState('');

  const catalog = useBuilderModelCatalog(organizationId, open);
  const credentials = useBuilderCredentials(organizationId, open);
  const session = useStartBuilderSession();

  const providers = useMemo(() => {
    const usable = new Set(
      (credentials.data ?? [])
        .filter((credential) => USABLE_AUTH_METHODS.has(credential.authMethod))
        .map((credential) => credential.providerSlug),
    );
    return (catalog.data ?? []).filter((provider) => usable.has(provider.name));
  }, [catalog.data, credentials.data]);

  const models = useMemo(() => {
    const provider = providers.find((entry) => entry.name === providerSlug);
    if (!provider) return [];
    // Prefer chat-capable models; a static catalog without tags offers all.
    const chat = provider.models.filter((model) => model.tags.includes('chat'));
    return chat.length > 0 ? chat : provider.models;
  }, [providers, providerSlug]);

  // A lone option needs no picking — the common dev org has exactly one
  // provider and would otherwise click through two selects every time.
  useEffect(() => {
    if (providerSlug === '' && providers.length === 1) {
      setProviderSlug(providers[0].name);
    }
  }, [providers, providerSlug]);
  useEffect(() => {
    if (modelId === '' && models.length === 1) setModelId(models[0].id);
  }, [models, modelId]);

  const ready = !catalog.isPending && credentials.data !== undefined;
  const canSubmit =
    goal.trim().length > 0 && providerSlug !== '' && modelId !== '';

  const outcome = session.data;
  const gaveUp = outcome !== undefined && outcome.status !== 'succeeded';

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setGoal('');
      setProviderSlug('');
      setModelId('');
      session.reset();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || session.isPending) return;
    session.mutate(
      {
        organizationId,
        goal: goal.trim(),
        model: { providerSlug, modelId },
        ...(projectId !== undefined && { projectId }),
      },
      {
        onSuccess: (result) => {
          if (result.status !== 'succeeded' || result.saved === undefined) {
            return; // stays open; the outcome alert explains
          }
          const automationSlug = automationSlugToParam(result.saved.name);
          onOpenChange(false);
          if (projectId !== undefined) {
            void navigate({
              to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
              params: { id: organizationId, projectId, automationSlug },
            });
          } else {
            void navigate({
              to: '/dashboard/$id/automations/$automationSlug',
              params: { id: organizationId, automationSlug },
            });
          }
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('builder.title')}
      description={t('builder.description')}
      submitText={t('builder.submit')}
      submittingText={t('builder.submitting')}
      isSubmitting={session.isPending}
      isValid={canSubmit}
      isDirty={goal.trim().length > 0}
      confirmDiscardOnDirty
      onSubmit={handleSubmit}
    >
      <Stack gap={4}>
        {catalog.isError && (
          <BuilderOutcomeAlert
            organizationId={organizationId}
            kind="failed"
            reason={automationErrorMessage(catalog.error)}
          />
        )}
        {ready && !catalog.isError && providers.length === 0 && (
          <Alert variant="warning" description={t('builder.noProviders')} />
        )}

        <Field label={t('builder.goalLabel')} htmlFor={goalId} required>
          <Textarea
            id={goalId}
            required
            rows={4}
            value={goal}
            placeholder={t('builder.goalPlaceholder')}
            onChange={(event) => setGoal(event.target.value)}
          />
        </Field>

        <Select
          label={t('builder.providerLabel')}
          placeholder={t('builder.providerPlaceholder')}
          emptyHint={tCommon('select.noProvidersHint')}
          required
          options={providers.map((provider) => ({
            value: provider.name,
            label: provider.displayName || provider.name,
          }))}
          value={providerSlug}
          onValueChange={(value) => {
            // Radix fires a spurious '' on unmounting items — never un-pick.
            if (value === '') return;
            setProviderSlug(value);
            setModelId('');
          }}
        />

        <Select
          label={t('builder.modelLabel')}
          placeholder={t('builder.modelPlaceholder')}
          emptyHint={tCommon('select.pickProviderFirstHint')}
          required
          options={models.map((model) => ({
            value: model.id,
            label: model.id,
          }))}
          value={modelId}
          onValueChange={(value) => {
            if (value === '') return;
            setModelId(value);
          }}
        />

        {session.isPending && (
          <Text as="p" variant="muted" className="text-sm" role="status">
            {t('builder.running')}
          </Text>
        )}
        {session.isError && (
          <BuilderOutcomeAlert
            organizationId={organizationId}
            providerSlug={providerSlug}
            kind="failed"
            reason={automationErrorMessage(session.error)}
          />
        )}
        {gaveUp &&
          (outcome.reason !== undefined && outcome.reason !== '' ? (
            <BuilderOutcomeAlert
              organizationId={organizationId}
              providerSlug={providerSlug}
              kind="gave-up"
              reason={outcome.reason}
            />
          ) : (
            <Alert
              variant="warning"
              title={t('builder.outcomeGaveUpTitle')}
              description={t('builder.gaveUpNoReason')}
            />
          ))}
      </Stack>
    </FormDialog>
  );
}
