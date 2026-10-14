'use client';

import {
  DEFAULT_SANDBOX_WORKSPACES,
  type SandboxWorkspacesConfig,
  sandboxWorkspacesConfigSchema,
} from '@tale/shared/schemas/governance';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import type { SettingsRowControlIds } from '@/app/features/settings/components/settings-row';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useT } from '@/lib/i18n/client';

import { createConfigParser } from '../governance/config-parser';
import { useUpsertGovernancePolicy } from '../governance/hooks/mutations';
import { useGovernancePolicy } from '../governance/hooks/queries';

interface WorkspaceCleanupEditorProps {
  organizationId: string;
}

const FORM_ID = 'sandbox-workspace-cleanup-form';

/** The values `sandboxWorkspacesConfigSchema` accepts for each number. */
const MIN_UNUSED_DAYS = 1;
const MAX_UNUSED_DAYS = 3650;
const MIN_WORKSPACE_GIB = 1;
const MAX_WORKSPACE_GIB = 10_240;
const MIN_IDLE_HOURS = 1;
const MAX_IDLE_HOURS = 8760;
/** The size the cap field holds while no cap is saved. */
const SUGGESTED_WORKSPACE_GIB = 50;

/** The policy as the form edits it: the cap is a switch and a size, so the
 * size typed in stays while the switch is off. */
interface WorkspaceCleanupForm {
  deleteUnused: boolean;
  unusedDays: number;
  reclaimOnDiskPressure: boolean;
  limitSize: boolean;
  maxWorkspaceGiB: number;
  reclaimMinIdleHours: number;
}

type NumberField = 'unusedDays' | 'maxWorkspaceGiB' | 'reclaimMinIdleHours';

function toForm(config: SandboxWorkspacesConfig): WorkspaceCleanupForm {
  return {
    deleteUnused: config.deleteUnused,
    unusedDays: config.unusedDays,
    reclaimOnDiskPressure: config.reclaimOnDiskPressure,
    limitSize: config.maxWorkspaceGiB !== undefined,
    maxWorkspaceGiB: config.maxWorkspaceGiB ?? SUGGESTED_WORKSPACE_GIB,
    reclaimMinIdleHours: config.reclaimMinIdleHours,
  };
}

function toConfig(values: WorkspaceCleanupForm): SandboxWorkspacesConfig {
  return {
    deleteUnused: values.deleteUnused,
    unusedDays: values.unusedDays,
    reclaimOnDiskPressure: values.reclaimOnDiskPressure,
    ...(values.limitSize ? { maxWorkspaceGiB: values.maxWorkspaceGiB } : {}),
    reclaimMinIdleHours: values.reclaimMinIdleHours,
  };
}

// No policy file means the schema defaults, which the cleanup applies as
// well, so the editor shows the rules actually in force.
const parseConfig = createConfigParser(sandboxWorkspacesConfigSchema, () => ({
  ...DEFAULT_SANDBOX_WORKSPACES,
}));

/**
 * When a project agent's workspace that nobody uses any more is deleted, and
 * when an idle one goes for disk space or its size: the organization's
 * `sandbox_workspaces` policy. Reading the policy is an admin read, so the
 * page renders this section for admins only. It saves through the settings
 * header's grouped Save/Discard cluster, like the page's limits.
 */
export function WorkspaceCleanupEditor({
  organizationId,
}: WorkspaceCleanupEditorProps) {
  const { t } = useT('sandboxes');
  const policy = useGovernancePolicy(organizationId, 'sandbox_workspaces');
  const { mutateAsync: upsertPolicy } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  // A read that has not answered yet, or whose first answer failed, is no
  // policy at all: it never becomes an editable set of defaults someone could
  // save over the real one. A failed refresh keeps the last answer.
  const savedConfig = useMemo<WorkspaceCleanupForm | undefined>(
    () =>
      policy.data === undefined
        ? undefined
        : toForm(parseConfig(policy.data?.config)),
    [policy.data],
  );
  const readFailed = policy.isError && policy.data === undefined;

  const schema = useMemo(() => {
    const whole = (min: number, max: number, message: string) =>
      z
        .number({ error: message })
        .int(message)
        .min(min, message)
        .max(max, message);
    return z.object({
      deleteUnused: z.boolean(),
      unusedDays: whole(
        MIN_UNUSED_DAYS,
        MAX_UNUSED_DAYS,
        t('cleanup.invalidDays'),
      ),
      reclaimOnDiskPressure: z.boolean(),
      limitSize: z.boolean(),
      maxWorkspaceGiB: whole(
        MIN_WORKSPACE_GIB,
        MAX_WORKSPACE_GIB,
        t('cleanup.invalidSize'),
      ),
      reclaimMinIdleHours: whole(
        MIN_IDLE_HOURS,
        MAX_IDLE_HOURS,
        t('cleanup.invalidHours'),
      ),
    });
  }, [t]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure.
  const save = useCallback(
    async (values: WorkspaceCleanupForm) => {
      try {
        await upsertPolicy({
          organizationId,
          policyType: 'sandbox_workspaces',
          config: toConfig(values),
        });
      } catch (err) {
        console.error('[workspaceCleanup save]', err);
        throw new Error(t('cleanup.saveFailed'), { cause: err });
      }
    },
    [organizationId, t, upsertPolicy],
  );

  const editor = useFormEditor<WorkspaceCleanupForm>({
    data: savedConfig,
    defaultValues: toForm(DEFAULT_SANDBOX_WORKSPACES),
    schema,
    save,
  });
  // Unregistered until the saved policy is known, so the cluster never
  // offers to save a section that has nothing to edit yet.
  useRegisterGroupedEditor(editor, { enabled: savedConfig !== undefined });

  const {
    control,
    register,
    getValues,
    resetField,
    setValue,
    formState: { errors },
  } = editor.form;
  const [deleteUnused, reclaimOnDiskPressure, limitSize] = useWatch({
    control,
    name: ['deleteUnused', 'reclaimOnDiskPressure', 'limitSize'],
  });
  const idleHoursApply = reclaimOnDiskPressure || limitSize;

  // A switch turned off disables its number: an entry that is not a valid
  // number would then hold Save back from a field nobody can edit, so it
  // returns to its saved value.
  const resetIfInvalid = useCallback(
    (name: NumberField) => {
      if (!schema.shape[name].safeParse(getValues(name)).success) {
        resetField(name);
      }
    },
    [getValues, resetField, schema],
  );

  const onDeleteUnusedChange = useCallback(
    (checked: boolean) => {
      setValue('deleteUnused', checked, { shouldDirty: true });
      if (!checked) resetIfInvalid('unusedDays');
    },
    [resetIfInvalid, setValue],
  );

  const onReclaimOnDiskPressureChange = useCallback(
    (checked: boolean) => {
      setValue('reclaimOnDiskPressure', checked, { shouldDirty: true });
      if (!checked && !getValues('limitSize')) {
        resetIfInvalid('reclaimMinIdleHours');
      }
    },
    [getValues, resetIfInvalid, setValue],
  );

  const onLimitSizeChange = useCallback(
    (checked: boolean) => {
      setValue('limitSize', checked, { shouldDirty: true });
      if (checked) return;
      resetIfInvalid('maxWorkspaceGiB');
      if (!getValues('reclaimOnDiskPressure')) {
        resetIfInvalid('reclaimMinIdleHours');
      }
    },
    [getValues, resetIfInvalid, setValue],
  );

  // The row's control: a whole number, disabled on the element, not through
  // `register` — a field registered as disabled drops its value from the
  // save, and a saved number must survive a switch that is off.
  const numberField =
    (
      name: NumberField,
      bounds: { min: number; max: number },
      enabled: boolean,
    ) =>
    ({ labelId, descriptionId }: SettingsRowControlIds) => (
      <Input
        id={`${FORM_ID}-${name}`}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={1}
        wrapperClassName="w-full"
        errorMessage={errors[name]?.message}
        {...register(name, { valueAsNumber: true })}
        disabled={!enabled}
      />
    );

  return (
    <Skeletonize loading={policy.isLoading} label={t('cleanup.title')}>
      <SettingsSection
        title={t('cleanup.title')}
        description={t('cleanup.description')}
      >
        {readFailed ? (
          <p role="alert" className="text-destructive text-sm">
            {t('cleanup.loadFailed')}
          </p>
        ) : (
          <form id={FORM_ID} onSubmit={editor.submit}>
            <fieldset disabled={editor.isLoading} className="contents">
              <SettingsFieldList>
                <SettingsToggleRow
                  className="py-5"
                  label={t('cleanup.deleteUnused')}
                  description={t('cleanup.deleteUnusedHint')}
                  checked={deleteUnused}
                  onCheckedChange={onDeleteUnusedChange}
                  disabled={editor.isLoading || editor.isSaving}
                />
                <SettingsFieldRow
                  label={t('cleanup.unusedDays')}
                  description={t('cleanup.unusedDaysHint')}
                >
                  {numberField(
                    'unusedDays',
                    { min: MIN_UNUSED_DAYS, max: MAX_UNUSED_DAYS },
                    deleteUnused,
                  )}
                </SettingsFieldRow>
                <SettingsToggleRow
                  className="py-5"
                  label={t('cleanup.reclaimOnDiskPressure')}
                  description={t('cleanup.reclaimOnDiskPressureHint')}
                  checked={reclaimOnDiskPressure}
                  onCheckedChange={onReclaimOnDiskPressureChange}
                  disabled={editor.isLoading || editor.isSaving}
                />
                <SettingsToggleRow
                  className="py-5"
                  label={t('cleanup.limitSize')}
                  description={t('cleanup.limitSizeHint')}
                  checked={limitSize}
                  onCheckedChange={onLimitSizeChange}
                  disabled={editor.isLoading || editor.isSaving}
                />
                <SettingsFieldRow
                  label={t('cleanup.maxWorkspaceGiB')}
                  description={t('cleanup.maxWorkspaceGiBHint')}
                >
                  {numberField(
                    'maxWorkspaceGiB',
                    { min: MIN_WORKSPACE_GIB, max: MAX_WORKSPACE_GIB },
                    limitSize,
                  )}
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('cleanup.reclaimMinIdleHours')}
                  description={t('cleanup.reclaimMinIdleHoursHint')}
                >
                  {numberField(
                    'reclaimMinIdleHours',
                    { min: MIN_IDLE_HOURS, max: MAX_IDLE_HOURS },
                    idleHoursApply,
                  )}
                </SettingsFieldRow>
              </SettingsFieldList>
            </fieldset>
          </form>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
