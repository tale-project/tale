'use client';

/**
 * The organization's embedding model — which provider/model writes vectors
 * into its knowledge corpus, and at what width. Required for knowledge search
 * on ANY database (including the deployment default), which is why this
 * section has no enable switch: there is no "off" that works, only configured
 * or not-yet-configured.
 *
 * On the unified editor contract: fields batch through the settings header's
 * Discard/Save cluster; Remove is an instant action behind a confirm dialog.
 * The provider/credential selects offer the credentials already stored under
 * Settings → AI providers — the config only NAMES a credential, it never
 * carries a secret itself.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useProviderCredentials } from '@/app/features/settings/providers/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteOrgKnowledgeEmbedding,
  useSaveOrgKnowledgeEmbedding,
} from '../hooks/mutations';
import { useEmbeddingRecommendations } from '../hooks/queries';
import {
  mapOrgResidencyError,
  orgResidencyErrorCode,
} from '../org-residency-errors';
import { READ_ONLY_EMPTY, StatusBadge } from './residency-chrome';

/** The org's embedding config as the admin form reads it. */
export interface KnowledgeEmbeddingView {
  configured: boolean;
  providerSlug?: string;
  credentialId?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

type EmbeddingForm = {
  providerSlug: string;
  credentialId: string; // DEFAULT_CREDENTIAL = the org's default for the provider
  model: string;
  dimensions: string; // free numeric input; parsed on save (never guessed)
  baseUrl: string;
};

/**
 * Sentinel for "the org's default credential for this provider" — a Radix
 * Select item may not carry an empty value, and a real Convex id can never
 * collide with this string.
 */
const DEFAULT_CREDENTIAL = '__default__';

const EMPTY_FORM: EmbeddingForm = {
  providerSlug: '',
  credentialId: DEFAULT_CREDENTIAL,
  model: '',
  dimensions: '',
  baseUrl: '',
};

function formFromView(
  view: KnowledgeEmbeddingView | undefined,
): EmbeddingForm | undefined {
  if (view === undefined) return undefined;
  if (!view.configured) return EMPTY_FORM;
  return {
    providerSlug: view.providerSlug ?? '',
    credentialId: view.credentialId ?? DEFAULT_CREDENTIAL,
    model: view.model ?? '',
    dimensions: view.dimensions === undefined ? '' : String(view.dimensions),
    baseUrl: view.baseUrl ?? '',
  };
}

function isValidDimensions(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 16_000;
}

function isValidBaseUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const FORM_ID = 'org-embedding-form';

export function OrgEmbeddingSection({
  organizationId,
  view,
  readError,
  readOnly,
  sharedDatabase,
}: {
  organizationId: string;
  view: KnowledgeEmbeddingView | undefined;
  readError?: string;
  readOnly: boolean;
  /** The org runs on the shared deployment DB (no BYO knowledge connection). */
  sharedDatabase: boolean;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();

  const save = useSaveOrgKnowledgeEmbedding(organizationId);
  const remove = useDeleteOrgKnowledgeEmbedding(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);
  const credentials = useMemo(
    () => credentialsQuery.data ?? [],
    [credentialsQuery.data],
  );

  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // Same switch contract as the sibling sections: ON only REVEALS the form
  // (nothing is configured until the header Save commits), OFF on a saved
  // config routes through the remove confirm. Unlike the siblings, "off"
  // still shows the search-unavailable warning below — there is no working
  // default to fall back to, so the state stays visible while collapsed.
  const [enabled, setEnabled] = useState(Boolean(view?.configured));

  const configured = Boolean(view?.configured);
  useEffect(() => {
    setEnabled(configured);
  }, [configured]);

  // The group AND-s every registered section's validity into the shared Save.
  // A COMPLETELY empty form is valid while nothing is configured — "not
  // configured" is a legitimate resting state, and an untouched-empty section
  // isn't dirty, so the group never tries to save it. The moment any field is
  // filled, the full constraints apply; and once a config exists, clearing
  // the fields is invalid too (removal goes through the toggle, not an empty
  // save).
  const schema = useMemo(
    () =>
      z
        .object({
          providerSlug: z.string(),
          credentialId: z.string(),
          model: z.string(),
          dimensions: z.string(),
          baseUrl: z.string(),
        })
        .superRefine((values, ctx) => {
          const empty =
            values.providerSlug === '' &&
            values.model === '' &&
            values.dimensions === '' &&
            values.baseUrl === '';
          if (empty && !configured) return;
          if (values.providerSlug === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['providerSlug'],
              message: t('dataResidency.orgEmbedding.errors.providerRequired'),
            });
          }
          if (values.model === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['model'],
              message: t('dataResidency.orgEmbedding.errors.modelRequired'),
            });
          }
          if (!isValidDimensions(values.dimensions)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['dimensions'],
              message: t('dataResidency.orgEmbedding.errors.dimensionsInvalid'),
            });
          }
          if (!isValidBaseUrl(values.baseUrl)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['baseUrl'],
              message: t('dataResidency.orgEmbedding.errors.baseUrlInvalid'),
            });
          }
        }),
    [t, configured],
  );

  const data = useMemo(() => formFromView(view), [view]);

  const saveForm = useCallback(
    async (values: EmbeddingForm) => {
      try {
        await save.mutateAsync({
          organizationId,
          providerSlug: values.providerSlug,
          credentialId:
            values.credentialId === DEFAULT_CREDENTIAL
              ? undefined
              : values.credentialId,
          model: values.model.trim(),
          dimensions: Number(values.dimensions),
          baseUrl: values.baseUrl.trim() || undefined,
        });
      } catch (err) {
        // A credential rejection belongs under the credential select —
        // rethrow it untouched so `mapServerError` can pin it there; anything
        // else becomes the translated line the header cluster toasts once.
        const code = orgResidencyErrorCode(err);
        if (
          code === 'CREDENTIAL_NOT_FOUND' ||
          code === 'CREDENTIAL_PROVIDER_MISMATCH' ||
          code === 'CREDENTIAL_DISABLED'
        ) {
          throw err;
        }
        throw new Error(mapOrgResidencyError(err, t), { cause: err });
      }
    },
    [organizationId, save, t],
  );

  // The credential codes rethrown by `saveForm` land here as field issues —
  // the fix (pick another credential) happens right at the select.
  const mapServerError = useCallback(
    (err: unknown) => {
      const code = orgResidencyErrorCode(err);
      if (code === 'CREDENTIAL_NOT_FOUND') {
        return [
          {
            path: 'credentialId',
            message: t('dataResidency.orgEmbedding.errors.credentialNotFound'),
          },
        ];
      }
      if (code === 'CREDENTIAL_PROVIDER_MISMATCH') {
        return [
          {
            path: 'credentialId',
            message: t('dataResidency.orgEmbedding.errors.credentialMismatch'),
          },
        ];
      }
      if (code === 'CREDENTIAL_DISABLED') {
        return [
          {
            path: 'credentialId',
            message: t('dataResidency.orgEmbedding.errors.credentialDisabled'),
          },
        ];
      }
      return null;
    },
    [t],
  );

  const editor = useFormEditor<EmbeddingForm>({
    data,
    defaultValues: EMPTY_FORM,
    schema,
    save: saveForm,
    mapServerError,
  });
  useRegisterGroupedEditor(editor, { enabled: !readOnly });

  const {
    control,
    register,
    setValue,
    watch,
    formState: { errors },
  } = editor.form;

  const selectedProvider = watch('providerSlug');

  // Provider options: every provider the org holds a credential for, plus the
  // stored value itself (so a config whose credential set changed still shows
  // what it points at instead of a blank select).
  const providerOptions = useMemo(() => {
    const slugs = new Set(credentials.map((c) => c.providerSlug));
    if (selectedProvider) slugs.add(selectedProvider);
    return [...slugs]
      .sort((a, b) => a.localeCompare(b))
      .map((slug) => ({ value: slug, label: slug }));
  }, [credentials, selectedProvider]);

  const credentialOptions = useMemo(() => {
    const own = credentials
      .filter((c) => c.providerSlug === selectedProvider)
      .map((c) => ({ value: c.id, label: c.name }));
    return [
      {
        value: DEFAULT_CREDENTIAL,
        label: t('dataResidency.orgEmbedding.credentialDefault'),
      },
      ...own,
    ];
  }, [credentials, selectedProvider, t]);

  async function onRemove() {
    try {
      await remove.mutateAsync({ organizationId });
      toast({ description: t('dataResidency.orgEmbedding.removed') });
    } catch (err) {
      toast({
        variant: 'destructive',
        description: mapOrgResidencyError(err, t),
      });
    } finally {
      setRemoveConfirmOpen(false);
    }
  }

  // A curated pick from the catalogs the org's credentials already unlock —
  // it FILLS the form (the lookup nobody should do by hand is the vector
  // width); committing stays with the unified Save, like every other field.
  const recommendationsQuery = useEmbeddingRecommendations(organizationId, {
    enabled: !readOnly && !configured && readError === undefined,
  });
  const recommendation = recommendationsQuery.data?.[0];
  const applyRecommendation = useCallback(() => {
    if (recommendation === undefined) return;
    setEnabled(true);
    setValue('providerSlug', recommendation.providerSlug, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('credentialId', DEFAULT_CREDENTIAL, { shouldDirty: true });
    setValue('model', recommendation.model, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('dimensions', String(recommendation.dimensions), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [recommendation, setValue]);

  const recommendationAlert =
    !configured && recommendation !== undefined ? (
      <Alert
        variant="info"
        description={
          <HStack gap={3} align="center" className="flex-wrap">
            <span>
              {t('dataResidency.orgEmbedding.recommendationBody', {
                model: recommendation.model,
                provider: recommendation.providerSlug,
                dimensions: recommendation.dimensions,
              })}
            </span>
            <Button size="sm" variant="secondary" onClick={applyRecommendation}>
              {t('dataResidency.orgEmbedding.recommendationApply')}
            </Button>
          </HStack>
        }
      />
    ) : null;

  function onToggle(checked: boolean) {
    if (checked) {
      setEnabled(true);
      return;
    }
    if (configured) {
      setRemoveConfirmOpen(true);
      return;
    }
    editor.reset();
    setEnabled(false);
  }

  // Unlike the sibling toggles, the badge tracks the PERSISTED state, not the
  // reveal state: a just-opened empty form is not "Configured".
  const statusBadge = (
    <StatusBadge
      enabled={configured}
      onLabel={t('dataResidency.orgEmbedding.statusConfigured')}
      offLabel={t('dataResidency.orgEmbedding.statusNotConfigured')}
    />
  );

  return (
    <SettingsSection
      title={t('dataResidency.orgEmbedding.title')}
      description={t('dataResidency.orgEmbedding.description')}
      action={
        readError ? undefined : readOnly ? (
          statusBadge
        ) : (
          <HStack gap={2} align="center">
            {statusBadge}
            <Switch
              aria-label={t('dataResidency.orgEmbedding.title')}
              checked={enabled}
              disabled={remove.isPending}
              onCheckedChange={onToggle}
            />
          </HStack>
        )
      }
    >
      {readError ? (
        <Alert
          variant="warning"
          description={t('dataResidency.orgEmbedding.errors.readFailed', {
            error: readError,
          })}
        />
      ) : readOnly ? (
        <>
          <Alert
            variant="info"
            description={
              <>
                <strong>{t('dataResidency.readOnly.title')}</strong>{' '}
                {t('dataResidency.orgEmbedding.readOnlyBody')}
              </>
            }
          />
          {configured ? (
            <SettingsFieldList>
              <SettingsFieldRow
                label={t('dataResidency.orgEmbedding.provider')}
              >
                <Input
                  aria-label={t('dataResidency.orgEmbedding.provider')}
                  value={view?.providerSlug || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('dataResidency.orgEmbedding.model')}>
                <Input
                  aria-label={t('dataResidency.orgEmbedding.model')}
                  value={view?.model || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={t('dataResidency.orgEmbedding.dimensions')}
              >
                <Input
                  aria-label={t('dataResidency.orgEmbedding.dimensions')}
                  value={
                    view?.dimensions === undefined
                      ? READ_ONLY_EMPTY
                      : String(view.dimensions)
                  }
                  readOnly
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          ) : null}
        </>
      ) : !enabled ? (
        // Collapsed ≠ fine here: with no embedding model, knowledge search
        // refuses — the consequence stays visible while the form is hidden,
        // unlike the sibling sections whose "off" is a working default. The
        // recommendation rides right under it: the fix, one click away.
        !configured ? (
          <Stack gap={3}>
            <Alert
              variant="warning"
              description={t('dataResidency.orgEmbedding.notConfiguredWarning')}
            />
            {recommendationAlert}
          </Stack>
        ) : null
      ) : (
        <Stack gap={5}>
          {!configured ? (
            <Alert
              variant="warning"
              description={t('dataResidency.orgEmbedding.notConfiguredWarning')}
            />
          ) : null}
          {recommendationAlert}
          {credentialsQuery.data !== undefined && credentials.length === 0 ? (
            <Alert
              variant="info"
              description={t('dataResidency.orgEmbedding.noCredentials')}
            />
          ) : null}
          <form id={FORM_ID} onSubmit={editor.submit}>
            <fieldset disabled={editor.isLoading} className="contents">
              <SettingsFieldList>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.provider')}
                  required
                >
                  <Controller
                    control={control}
                    name="providerSlug"
                    render={({ field }) => (
                      <Select
                        aria-label={t('dataResidency.orgEmbedding.provider')}
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          // A credential belongs to one provider; switching
                          // providers resets the pick to the new provider's
                          // default rather than carrying a mismatched id.
                          setValue('credentialId', DEFAULT_CREDENTIAL, {
                            shouldDirty: true,
                          });
                        }}
                        options={providerOptions}
                        placeholder={t(
                          'dataResidency.orgEmbedding.providerPlaceholder',
                        )}
                        emptyHint={t(
                          'dataResidency.orgEmbedding.noCredentials',
                        )}
                        error={Boolean(errors.providerSlug)}
                        description={errors.providerSlug?.message}
                      />
                    )}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.credential')}
                  description={t('dataResidency.orgEmbedding.credentialHint')}
                >
                  <Controller
                    control={control}
                    name="credentialId"
                    render={({ field }) => (
                      <Select
                        aria-label={t('dataResidency.orgEmbedding.credential')}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={credentialOptions}
                        error={Boolean(errors.credentialId)}
                        description={errors.credentialId?.message}
                      />
                    )}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.model')}
                  description={t('dataResidency.orgEmbedding.modelHint')}
                  required
                >
                  <Input
                    aria-label={t('dataResidency.orgEmbedding.model')}
                    placeholder="text-embedding-3-small"
                    wrapperClassName="w-full"
                    errorMessage={errors.model?.message}
                    {...register('model')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.dimensions')}
                  description={t('dataResidency.orgEmbedding.dimensionsHint')}
                  required
                >
                  <Input
                    aria-label={t('dataResidency.orgEmbedding.dimensions')}
                    type="number"
                    min={1}
                    max={16000}
                    step={1}
                    placeholder="1536"
                    wrapperClassName="w-full"
                    errorMessage={errors.dimensions?.message}
                    {...register('dimensions')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgEmbedding.baseUrl')}
                  description={t('dataResidency.orgEmbedding.baseUrlHint')}
                >
                  <Input
                    aria-label={t('dataResidency.orgEmbedding.baseUrl')}
                    placeholder="https://api.example.com/v1"
                    wrapperClassName="w-full"
                    errorMessage={errors.baseUrl?.message}
                    {...register('baseUrl')}
                  />
                </SettingsFieldRow>
              </SettingsFieldList>
            </fieldset>
          </form>
          {sharedDatabase ? (
            <p className="text-muted-foreground text-xs">
              {t('dataResidency.orgEmbedding.sharedDbNote')}
            </p>
          ) : null}
        </Stack>
      )}

      <ConfirmDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        title={t('dataResidency.orgEmbedding.removeConfirm.title')}
        description={t('dataResidency.orgEmbedding.removeConfirm.description')}
        confirmText={t('dataResidency.orgEmbedding.removeConfirm.confirm')}
        isLoading={remove.isPending}
        variant="destructive"
        onConfirm={() => void onRemove()}
      />
    </SettingsSection>
  );
}
