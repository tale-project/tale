'use client';

import { Badge } from '@tale/ui/badge';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import type { SandboxQuotaConfig } from '@/lib/shared/schemas/governance';

import { useUpsertGovernancePolicy } from '../governance/hooks/mutations';

interface SandboxQuotaEditorProps {
  organizationId: string;
}

const QUOTA_FIELDS = [
  { field: 'maxSessionsPerOrg', budget: 'project' },
  { field: 'maxWorkflowSessionsPerOrg', budget: 'workflow' },
  { field: 'maxRenderSessionsPerOrg', budget: 'render' },
] as const;

const FORM_ID = 'sandbox-quota-form';

/** The three organization admission budgets share one settings editor. */
export function SandboxQuotaEditor({
  organizationId,
}: SandboxQuotaEditorProps) {
  const { t } = useT('sandboxes');
  const ability = useAbility();

  const upsertMutation = useUpsertGovernancePolicy({ errorToast: false });
  const usage = useBackendQuery(
    'sandbox/session_queries_public:getSandboxQuotaUsage',
    { organizationId },
  );

  // The usage endpoint exposes the same saved limits to readers and editors.
  // A missing response never becomes an editable set of schema defaults.
  const savedConfig = useMemo<SandboxQuotaConfig | undefined>(() => {
    const project = usage.data?.find((row) => row.budget === 'project');
    const workflow = usage.data?.find((row) => row.budget === 'workflow');
    const render = usage.data?.find((row) => row.budget === 'render');
    if (!project || !workflow || !render) return undefined;
    return {
      maxSessionsPerOrg: project.cap,
      maxWorkflowSessionsPerOrg: workflow.cap,
      maxRenderSessionsPerOrg: render.cap,
    };
  }, [usage.data]);
  const cannotManage = ability.cannot('write', 'orgSettings');
  const canEdit = !cannotManage;

  const schema = useMemo(() => {
    const limit = z
      .number({ error: t('limits.invalidSessions') })
      .int(t('limits.invalidSessions'))
      .min(1, t('limits.invalidSessions'))
      .max(500, t('limits.invalidSessions'));
    return z.object({
      maxSessionsPerOrg: limit,
      maxWorkflowSessionsPerOrg: limit,
      maxRenderSessionsPerOrg: limit,
    });
  }, [t]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure.
  const save = useCallback(
    async (values: SandboxQuotaConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'sandbox_quota',
          config: {
            ...savedConfig,
            ...values,
          } satisfies SandboxQuotaConfig,
        });
      } catch (err) {
        console.error('[sandboxQuota save]', err);
        throw new Error(t('limits.saveFailed'), { cause: err });
      }
    },
    [organizationId, savedConfig, t, upsertMutation],
  );

  const editor = useFormEditor<SandboxQuotaConfig>({
    data: savedConfig,
    schema,
    save,
  });
  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(editor, {
    enabled: canEdit && savedConfig !== undefined,
  });

  const {
    register,
    formState: { errors },
  } = editor.form;

  return (
    <Skeletonize loading={usage.isLoading} label={t('limits.title')}>
      <SettingsSection
        title={t('limits.title')}
        description={t('limits.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <SettingsFieldList>
              {QUOTA_FIELDS.map(({ field, budget }) => {
                const current = usage.data?.find(
                  (row) => row.budget === budget,
                );
                return (
                  <SettingsFieldRow
                    key={field}
                    label={t(`quota.budgets.${budget}`)}
                    description={t(`quota.budgetHints.${budget}`)}
                  >
                    <div className="flex flex-col gap-2">
                      <Input
                        aria-label={t(`quota.budgets.${budget}`)}
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        wrapperClassName="w-full"
                        errorMessage={errors[field]?.message}
                        {...register(field, { valueAsNumber: true })}
                      />
                      {current ? (
                        <Badge
                          className="self-start"
                          variant={
                            current.atLimit
                              ? 'destructive'
                              : current.nearLimit
                                ? 'yellow'
                                : 'slate'
                          }
                        >
                          {t('limits.usage', {
                            used: current.used,
                            limit: current.cap,
                          })}
                        </Badge>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          {t('limits.usageUnavailable')}
                        </p>
                      )}
                    </div>
                  </SettingsFieldRow>
                );
              })}
            </SettingsFieldList>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
