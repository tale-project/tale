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

/** The days `sandboxWorkspacesConfigSchema` accepts for `unusedDays`. */
const MIN_UNUSED_DAYS = 1;
const MAX_UNUSED_DAYS = 3650;

// No policy file means the schema defaults, which the cleanup applies as
// well, so the editor shows the rule actually in force.
const parseConfig = createConfigParser(sandboxWorkspacesConfigSchema, () => ({
  ...DEFAULT_SANDBOX_WORKSPACES,
}));

/**
 * When a project agent's workspace that nobody uses any more is deleted: the
 * organization's `sandbox_workspaces` policy. Reading the policy is an admin
 * read, so the page renders this section for admins only. It saves through
 * the settings header's grouped Save/Discard cluster, like the page's limits.
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
  const savedConfig = useMemo<SandboxWorkspacesConfig | undefined>(
    () =>
      policy.data === undefined ? undefined : parseConfig(policy.data?.config),
    [policy.data],
  );
  const readFailed = policy.isError && policy.data === undefined;

  const schema = useMemo(() => {
    const invalidDays = t('cleanup.invalidDays');
    return z.object({
      deleteUnused: z.boolean(),
      unusedDays: z
        .number({ error: invalidDays })
        .int(invalidDays)
        .min(MIN_UNUSED_DAYS, invalidDays)
        .max(MAX_UNUSED_DAYS, invalidDays),
    });
  }, [t]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure.
  const save = useCallback(
    async (values: SandboxWorkspacesConfig) => {
      try {
        await upsertPolicy({
          organizationId,
          policyType: 'sandbox_workspaces',
          config: {
            deleteUnused: values.deleteUnused,
            unusedDays: values.unusedDays,
          } satisfies SandboxWorkspacesConfig,
        });
      } catch (err) {
        console.error('[workspaceCleanup save]', err);
        throw new Error(t('cleanup.saveFailed'), { cause: err });
      }
    },
    [organizationId, t, upsertPolicy],
  );

  const editor = useFormEditor<SandboxWorkspacesConfig>({
    data: savedConfig,
    defaultValues: DEFAULT_SANDBOX_WORKSPACES,
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
  const deleteUnused = useWatch({ control, name: 'deleteUnused' });

  const onDeleteUnusedChange = useCallback(
    (checked: boolean) => {
      setValue('deleteUnused', checked, { shouldDirty: true });
      // Switching deletion off disables the days: an entry that is not a
      // valid number of days would then hold Save back from a field nobody
      // can edit, so it returns to its saved value.
      if (
        !checked &&
        !schema.shape.unusedDays.safeParse(getValues('unusedDays')).success
      ) {
        resetField('unusedDays');
      }
    },
    [getValues, resetField, schema, setValue],
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
                  {({ labelId, descriptionId }) => (
                    <Input
                      id={`${FORM_ID}-unusedDays`}
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                      type="number"
                      min={MIN_UNUSED_DAYS}
                      max={MAX_UNUSED_DAYS}
                      step={1}
                      wrapperClassName="w-full"
                      errorMessage={errors.unusedDays?.message}
                      {...register('unusedDays', { valueAsNumber: true })}
                      // Disabled on the element, not through `register`: a
                      // field registered as disabled drops its value from
                      // the save, and the saved days must survive a switch
                      // that is off.
                      disabled={!deleteUnused}
                    />
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
