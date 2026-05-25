'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeleton } from '@tale/ui/skeleton';
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

  const {
    form: {
      register,
      handleSubmit,
      getValues,
      formState: { errors },
    },
  } = editor;

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

  const skeleton = (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
      </div>
      {enabled && (
        <div className="flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-full rounded-md" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return <div aria-busy="true">{skeleton}</div>;
  }

  return (
    <PageSection
      title={t('uploadPolicy.title')}
      description={t('uploadPolicy.description')}
      action={
        <Switch
          label={t('uploadPolicy.enabled')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      {enabled && (
        <form id={FORM_ID} onSubmit={handleSubmit((values) => save(values))}>
          <fieldset
            disabled={cannotManage || editor.isLoading}
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
                  controller={editor}
                  formId={FORM_ID}
                  canEdit={!cannotManage}
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
