'use client';

import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  uploadPolicyConfigSchema,
  type UploadPolicyConfig,
} from '@/lib/shared/schemas/governance';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import {
  findConflictingExtensions,
  stringToExtensions,
} from './upload-policy-extensions';

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

const parseConfig = createConfigParser(uploadPolicyConfigSchema, () => ({
  enabled: false,
}));

function extensionsToString(exts?: string[]): string {
  return exts?.join(', ') ?? '';
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
// Single editor — owns data fetching, the form controller, the enable toggle
// state, save/toast wiring, and the loading state. Renders the REAL
// `SettingsSection` once, always, wrapped in `<Skeletonize>`; the skeleton-aware
// `<Switch>`/`<Input>` leaves mask themselves while loading, so the loading and
// loaded layouts are the SAME tree.
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
      z
        .object({
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
        })
        .superRefine((values, ctx) => {
          // An extension cannot be both allowed and blocked — flag the
          // conflict instead of silently saving a contradictory policy (#1479).
          const conflicts = findConflictingExtensions(
            values.allowedExtensions,
            values.blockedExtensions,
          );
          if (conflicts.length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['blockedExtensions'],
              message: t('uploadPolicy.conflictingExtensions', {
                extensions: conflicts.join(', '),
              }),
            });
          }
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
  const canManage = !cannotManage;
  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers and disabled policies stay unregistered so the cluster
  // never renders for a section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canManage && enabled });

  const {
    getValues,
    register,
    formState: { errors },
  } = editor.form;
  const switchDisabled = cannotManage || upsertMutation.isPending;

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
      <SettingsSection
        title={t('uploadPolicy.title')}
        description={t('uploadPolicy.description')}
        action={
          <Switch
            aria-label={t('uploadPolicy.enabled')}
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={switchDisabled}
          />
        }
      >
        {enabled && (
          <form id={FORM_ID} onSubmit={editor.submit}>
            <fieldset
              disabled={!canManage || editor.isLoading}
              className="contents"
            >
              <Stack gap={6}>
                {/* One field per row — the settings-form convention (side-
                    by-side fields read as one control and hide their
                    pairing). Short numeric fields stay max-w-xs. */}
                <Stack gap={4}>
                  <Input
                    label={t('uploadPolicy.allowedExtensions')}
                    placeholder={t('uploadPolicy.extensionPlaceholder')}
                    errorMessage={errors.allowedExtensions?.message}
                    {...register('allowedExtensions')}
                  />
                  <Input
                    label={t('uploadPolicy.blockedExtensions')}
                    placeholder={t('uploadPolicy.extensionPlaceholder')}
                    errorMessage={errors.blockedExtensions?.message}
                    {...register('blockedExtensions')}
                  />
                  <Input
                    label={t('uploadPolicy.allowedMimeTypes')}
                    placeholder={t('uploadPolicy.mimeTypePlaceholder')}
                    errorMessage={errors.allowedMimeTypes?.message}
                    {...register('allowedMimeTypes')}
                  />
                  <Input
                    label={`${t('uploadPolicy.maxFileSize')} (${t('uploadPolicy.mbUnit')})`}
                    type="number"
                    min={0}
                    step={1}
                    wrapperClassName="max-w-xs"
                    errorMessage={errors.maxFileSizeMB?.message}
                    {...register('maxFileSizeMB')}
                  />
                  <Input
                    label={`${t('uploadPolicy.maxVolumePerUser')} (${t('uploadPolicy.gbUnit')})`}
                    type="number"
                    min={0}
                    step={0.1}
                    wrapperClassName="max-w-xs"
                    errorMessage={errors.maxVolumeGB?.message}
                    {...register('maxVolumeGB')}
                  />
                </Stack>
              </Stack>
            </fieldset>
          </form>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
