'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { EditorActions, useFormEditor } from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  uploadPolicyConfigSchema,
  type UploadPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface UploadPolicyEditorProps {
  organizationId: string;
}

interface UploadPolicyForm {
  allowedExtensions: string;
  blockedExtensions: string;
  allowedMimeTypes: string;
  maxFileSizeMB: string;
  maxVolumeGB: string;
}

const FORM_ID = 'governance-upload-policy-form';

type UploadPolicyController = ReturnType<
  typeof useFormEditor<UploadPolicyForm>
>;

function parseConfig(raw: unknown): UploadPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = uploadPolicyConfigSchema.safeParse(obj);
  if (result.success) return result.data;
  return { enabled: false };
}

function extensionsToString(exts?: string[]): string {
  return exts?.join(', ') ?? '';
}

function stringToExtensions(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^\./, ''))
    .filter(Boolean);
}

function buildConfig(
  values: UploadPolicyForm,
  enabledValue: boolean,
): UploadPolicyConfig {
  const config: UploadPolicyConfig = { enabled: enabledValue };

  const allowed = stringToExtensions(values.allowedExtensions);
  if (allowed) config.allowedExtensions = allowed;

  const blocked = stringToExtensions(values.blockedExtensions);
  if (blocked) config.blockedExtensions = blocked;

  const mimes = values.allowedMimeTypes
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (mimes.length > 0) config.allowedMimeTypes = mimes;

  const sizeMB = Number(values.maxFileSizeMB);
  if (values.maxFileSizeMB && !Number.isNaN(sizeMB) && sizeMB > 0) {
    config.maxFileSizeBytes = sizeMB * 1024 * 1024;
  }

  const volGB = Number(values.maxVolumeGB);
  if (values.maxVolumeGB && !Number.isNaN(volGB) && volGB > 0) {
    config.maxTotalVolumeBytesPerUser = volGB * 1024 * 1024 * 1024;
  }

  return config;
}

// =============================================================================
// Plain presentational view — no data/mutation hooks of its own. Renders the
// real `PageSection` with the skeleton-aware enable `Switch` in the header and,
// when enabled, the field form from an injected `controller`. Rendered both
// live (by the container) and as its own skeleton (the container wraps it in
// `<Skeletonize>`), so the loading and loaded layouts are the SAME tree. The
// skeleton-aware `<Switch>`/`<Input>` leaves mask themselves while loading.
// =============================================================================
export function UploadPolicyEditorView({
  controller,
  onSave,
  enabled,
  canManage,
  switchDisabled,
  onToggleEnabled,
}: {
  controller: UploadPolicyController;
  onSave: (values: UploadPolicyForm) => Promise<void>;
  enabled: boolean;
  canManage: boolean;
  switchDisabled: boolean;
  onToggleEnabled: (next: boolean) => void;
}) {
  const { t } = useT('governance');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = controller.form;

  return (
    <PageSection
      title={t('uploadPolicy.title')}
      description={t('uploadPolicy.description')}
      action={
        <Switch
          label={t('uploadPolicy.enabled')}
          checked={enabled}
          onCheckedChange={onToggleEnabled}
          disabled={switchDisabled}
        />
      }
    >
      {enabled && (
        <form id={FORM_ID} onSubmit={handleSubmit(onSave)}>
          <fieldset
            disabled={!canManage || controller.isLoading}
            className="contents"
          >
            <Stack gap={6} className="max-w-2xl">
              <Stack gap={4}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label={t('uploadPolicy.allowedExtensions')}
                    placeholder={t('uploadPolicy.extensionPlaceholder')}
                    size="sm"
                    errorMessage={errors.allowedExtensions?.message}
                    {...register('allowedExtensions')}
                  />
                  <Input
                    label={t('uploadPolicy.blockedExtensions')}
                    placeholder={t('uploadPolicy.extensionPlaceholder')}
                    size="sm"
                    errorMessage={errors.blockedExtensions?.message}
                    {...register('blockedExtensions')}
                  />
                </div>

                <Input
                  label={t('uploadPolicy.allowedMimeTypes')}
                  placeholder={t('uploadPolicy.mimeTypePlaceholder')}
                  size="sm"
                  errorMessage={errors.allowedMimeTypes?.message}
                  {...register('allowedMimeTypes')}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label={`${t('uploadPolicy.maxFileSize')} (${t('uploadPolicy.mbUnit')})`}
                    type="number"
                    size="sm"
                    min={0}
                    step={1}
                    errorMessage={errors.maxFileSizeMB?.message}
                    {...register('maxFileSizeMB')}
                  />
                  <Input
                    label={`${t('uploadPolicy.maxVolumePerUser')} (${t('uploadPolicy.gbUnit')})`}
                    type="number"
                    size="sm"
                    min={0}
                    step={0.1}
                    errorMessage={errors.maxVolumeGB?.message}
                    {...register('maxVolumeGB')}
                  />
                </div>
              </Stack>

              <HStack justify="end">
                <EditorActions
                  controller={controller}
                  formId={FORM_ID}
                  canEdit={canManage}
                  entityKind="governance_upload_policy"
                />
              </HStack>
            </Stack>
          </fieldset>
        </form>
      )}
    </PageSection>
  );
}

// =============================================================================
// Container — owns data fetching, the form controller, the enable toggle
// state, save/toast wiring, and the loading state. Wraps the plain view in
// `<Skeletonize>` so the same tree renders the skeleton.
// =============================================================================
export function UploadPolicyEditor({
  organizationId,
}: UploadPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'upload_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);
  const cannotManage = ability.cannot('write', 'orgSettings');

  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!isLoading) setEnabled(savedConfig.enabled);
  }, [isLoading, savedConfig]);

  const schema = useMemo(
    () =>
      z.object({
        allowedExtensions: z.string(),
        blockedExtensions: z.string(),
        allowedMimeTypes: z.string(),
        maxFileSizeMB: z.string().refine(
          (v) => {
            if (!v.trim()) return true;
            const n = Number(v);
            return !Number.isNaN(n) && n >= 0;
          },
          { message: t('uploadPolicy.invalidMaxFileSize') },
        ),
        maxVolumeGB: z.string().refine(
          (v) => {
            if (!v.trim()) return true;
            const n = Number(v);
            return !Number.isNaN(n) && n >= 0;
          },
          { message: t('uploadPolicy.invalidMaxVolume') },
        ),
      }),
    [t],
  );

  const data = useMemo<UploadPolicyForm | undefined>(() => {
    if (isLoading) return undefined;
    return {
      allowedExtensions: extensionsToString(savedConfig.allowedExtensions),
      blockedExtensions: extensionsToString(savedConfig.blockedExtensions),
      allowedMimeTypes: savedConfig.allowedMimeTypes?.join(', ') ?? '',
      maxFileSizeMB:
        savedConfig.maxFileSizeBytes != null
          ? String(savedConfig.maxFileSizeBytes / (1024 * 1024))
          : '',
      maxVolumeGB:
        savedConfig.maxTotalVolumeBytesPerUser != null
          ? String(
              savedConfig.maxTotalVolumeBytesPerUser / (1024 * 1024 * 1024),
            )
          : '',
    };
  }, [isLoading, savedConfig]);

  const save = useCallback(
    async (values: UploadPolicyForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'upload_policy',
          config: buildConfig(values, enabled),
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('uploadPolicy.saved'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('uploadPolicy.saveFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [enabled, organizationId, t, toast, upsertMutation],
  );

  const editor = useFormEditor<UploadPolicyForm>({
    data,
    schema,
    save,
  });

  const { getValues } = editor.form;

  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'upload_policy',
          config: buildConfig(getValues(), next),
        });
      } catch (err) {
        console.error('[uploadPolicy toggle]', err);
        setEnabled(!next);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('uploadPolicy.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [getValues, organizationId, t, toast, upsertMutation],
  );

  return (
    <Skeletonize loading={isLoading} label={t('uploadPolicy.title')}>
      <UploadPolicyEditorView
        controller={editor}
        onSave={save}
        enabled={enabled}
        canManage={!cannotManage}
        switchDisabled={cannotManage || upsertMutation.isPending}
        onToggleEnabled={handleToggleEnabled}
      />
    </Skeletonize>
  );
}
