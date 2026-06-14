'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '@tale/ui/alert';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { ModelSelector } from '@/app/components/ui/forms/model-selector';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { resolveModelLocale } from '@/lib/shared/utils/resolve-provider-locale';

import { useSaveAgent } from '../hooks/mutations';

type FormData = {
  name: string;
  displayName: string;
  description?: string;
};

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /**
   * Called with the new agent's slug after a successful create INSTEAD of the
   * default navigation to the agent's settings page. Hosts that embed the
   * dialog in another editor (the organigram canvas) use it to stay in place
   * and refresh their own view.
   */
  onCreated?: (agentName: string) => void;
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: CreateAgentDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { mutateAsync: saveAgent } = useSaveAgent();
  const { providers, isLoading: providersLoading } =
    useListProviders(organizationId);
  const { locale } = useLocale();

  // Ordered list of selected model refs (qualified `provider:id`). The FIRST
  // entry is the agent's default/primary model; the rest are its fallback
  // chain — same convention the agent edit page and runtime
  // (`config.ts` → `model: supportedModels[0]`) use. Reordering the list (via
  // ModelSelector) changes the default.
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  // Every model across all configured providers, as qualified refs. Used both
  // to seed the default and to resolve display/provider names for the list.
  const modelCatalog = useMemo(() => {
    const all: { ref: string; displayName: string; providerName: string }[] =
      [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        // Don't offer hidden/deprecated models when configuring a NEW agent —
        // they stay resolvable for agents that already reference them.
        if (model.hidden === true) continue;
        const resolved = resolveModelLocale(model, provider.i18n, locale);
        all.push({
          // Qualified form pins routing to this exact provider.
          ref: `${provider.name}:${model.id}`,
          displayName: resolved.displayName || model.displayName,
          providerName: provider.name,
        });
      }
    }
    return all;
  }, [providers, locale]);

  // No models means no provider is configured (or none exposes a model).
  // An agent must reference a real model, so creation can't proceed until one
  // exists — we surface this explicitly instead of letting submit no-op.
  const hasModels = modelCatalog.length > 0;

  // Options offered in the "add model" picker: everything not already selected.
  const availableOptions = useMemo(() => {
    const selected = new Set(selectedModels);
    return modelCatalog
      .filter((m) => !selected.has(m.ref))
      .map((m) => ({
        value: m.ref,
        label: m.displayName,
        description: t('agents.form.viaProvider', { provider: m.providerName }),
      }));
  }, [modelCatalog, selectedModels, t]);

  const getDisplayName = useCallback(
    (ref: string) =>
      modelCatalog.find((m) => m.ref === ref)?.displayName ??
      ref.split(':').pop() ??
      ref,
    [modelCatalog],
  );

  const getProviderName = useCallback(
    (ref: string) => modelCatalog.find((m) => m.ref === ref)?.providerName,
    [modelCatalog],
  );

  // Keep the selection valid against the live catalog. Two jobs in one pass:
  //   1. Drop any selected refs that no longer exist (a provider refresh can
  //      remove a model) — otherwise a stale ref survives to submit and fails
  //      with UNKNOWN_MODEL even though `hasModels` is true.
  //   2. Seed a sensible default when nothing valid is left, so a new agent is
  //      immediately usable. The user can add more or reorder to change it.
  useEffect(() => {
    const validRefs = new Set(modelCatalog.map((m) => m.ref));
    setSelectedModels((prev) => {
      const filtered = prev.filter((ref) => validRefs.has(ref));
      const unchanged =
        filtered.length === prev.length &&
        filtered.every((ref, i) => ref === prev[i]);
      if (unchanged) return prev;
      if (filtered.length > 0) return filtered;
      return modelCatalog[0] ? [modelCatalog[0].ref] : [];
    });
  }, [modelCatalog]);

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('agents.form.name'),
            }),
          )
          .regex(/^[a-z0-9][a-z0-9_-]*$/, t('agents.form.namePatternError')),
        displayName: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('agents.form.displayName'),
          }),
        ),
        description: z.string().optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting, errors, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    // Validate on change so the Continue button can gate on validity
    // (required fields filled) instead of only after a submit attempt.
    mode: 'onChange',
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
    },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setSelectedModels([]);
    }
  }, [open, reset]);

  const onSubmit = async (data: FormData) => {
    // First entry is the default; the rest are fallbacks. Fall back to the
    // first catalog model if (somehow) nothing is selected.
    const models =
      selectedModels.length > 0
        ? selectedModels
        : modelCatalog[0]
          ? [modelCatalog[0].ref]
          : [];
    if (models.length === 0) return;

    try {
      await saveAgent({
        organizationId,
        agentName: data.name,
        isNew: true,
        config: {
          displayName: data.displayName,
          description: data.description,
          systemInstructions: 'You are a helpful assistant.',
          supportedModels: models,
          // Agents created from chat should be usable in chat immediately —
          // `visibleInChat` is treated as false unless explicitly true
          // (see useChatAgents filter), so set it on creation.
          visibleInChat: true,
        },
      });
      toast({
        title: t('agents.agentCreated'),
        variant: 'success',
      });
      if (onCreated) {
        onCreated(data.name);
      } else {
        void navigate({
          to: '/dashboard/$id/agents/$agentId',
          params: { id: organizationId, agentId: data.name },
        });
      }
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'DUPLICATE_NAME') {
          setError('name', { message: t('agents.agentAlreadyExists') });
          return;
        }
        if (code === 'UNKNOWN_PROVIDER' || code === 'UNKNOWN_MODEL') {
          toast({
            title: error.data?.message ?? t('agents.agentCreateFailed'),
            variant: 'destructive',
          });
          return;
        }
        if (code === 'VALIDATION_ERROR') {
          toast({
            title: error.data?.message ?? t('agents.validationError'),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error(error);
      toast({
        title: t('agents.agentCreateFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('agents.createAgent')}
      submitText={t('agents.createDialog.continue')}
      submittingText={t('agents.createDialog.creating')}
      isSubmitting={isSubmitting}
      isValid={isValid && hasModels}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={t('agents.form.name')}
        labelInfo={t('agents.form.nameTooltip')}
        {...register('name')}
        placeholder={t('agents.form.namePlaceholder')}
        errorMessage={errors.name?.message}
      />
      <Text variant="caption" className="-mt-2">
        {t('agents.form.nameHelp')}
      </Text>

      <Input
        id="displayName"
        label={t('agents.form.displayName')}
        labelInfo={t('agents.form.displayNameTooltip')}
        {...register('displayName')}
        placeholder={t('agents.form.displayNamePlaceholder')}
        errorMessage={errors.displayName?.message}
      />

      <Textarea
        id="description"
        label={t('agents.form.description')}
        {...register('description')}
        placeholder={t('agents.form.descriptionPlaceholder')}
        rows={3}
      />

      {!providersLoading && !hasModels ? (
        <Alert
          variant="warning"
          title={t('agents.createDialog.noModelsTitle')}
          description={
            <Text variant="caption">
              {t('agents.createDialog.noModelsDescription')}{' '}
              <Link
                to="/dashboard/$id/settings/providers"
                params={{ id: organizationId }}
                className="text-primary underline underline-offset-2"
              >
                {t('agents.createDialog.noModelsLink')}
              </Link>
            </Text>
          }
        />
      ) : (
        // A composite group (reorderable list + add button), not a single
        // control — so a `Label htmlFor` would dangle. fieldset/legend gives
        // assistive tech the group association instead.
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">
            {t('agents.createDialog.model')}
          </legend>
          <ModelSelector
            models={selectedModels}
            onChange={setSelectedModels}
            availableOptions={availableOptions}
            getDisplayName={getDisplayName}
            getProviderName={getProviderName}
          />
          <Text variant="caption">
            {t('agents.createDialog.modelDefaultHint')}
          </Text>
        </fieldset>
      )}
    </FormDialog>
  );
}
