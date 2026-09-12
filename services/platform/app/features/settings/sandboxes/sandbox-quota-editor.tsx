'use client';

import {
  sandboxQuotaTotal,
  type SandboxQuotaConfig,
} from '@tale/shared/schemas/governance';
import { Badge } from '@tale/ui/badge';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo } from 'react';
import { useWatch } from 'react-hook-form';
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
import { BackendApiError } from '@/app/lib/backend/api-client';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import {
  pickString,
  readBackendErrorData,
} from '../governance/backend-error-data';
import { useUpsertGovernancePolicy } from '../governance/hooks/mutations';

interface SandboxQuotaEditorProps {
  organizationId: string;
  deploymentLimits?: ReturnsOf<'sandbox/session_queries_public:getSandboxDeploymentLimits'>;
  deploymentLimitsLoading: boolean;
  onRefreshDeploymentLimits: () => void;
}

const QUOTA_FIELDS = [
  { field: 'maxSessionsPerOrg', budget: 'project' },
  { field: 'maxWorkflowSessionsPerOrg', budget: 'workflow' },
  { field: 'maxRenderSessionsPerOrg', budget: 'render' },
] as const;

const FORM_ID = 'sandbox-quota-form';
const TOTAL_ID = `${FORM_ID}-total`;
const TOTAL_ERROR_ID = `${FORM_ID}-total-error`;

/** The three organization admission budgets share one settings editor. */
export function SandboxQuotaEditor({
  organizationId,
  deploymentLimits,
  deploymentLimitsLoading,
  onRefreshDeploymentLimits,
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
  const maxSessions =
    deploymentLimits?.status === 'available'
      ? deploymentLimits.maxSessions
      : undefined;
  const savedTotal =
    savedConfig === undefined ? undefined : sandboxQuotaTotal(savedConfig);

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
      // The grouped controller disables Save immediately, and this guard also
      // covers native form submission and a capacity update during editing.
      const total = sandboxQuotaTotal(values);
      if (maxSessions === undefined) {
        // No readable ceiling: only a total that does not grow may be saved.
        // Lowering limits can never oversubscribe more than the saved
        // configuration already does, and it is the one edit an admin needs
        // during a sandbox outage. The server applies the same rule.
        if (savedTotal === undefined || total > savedTotal) {
          throw new Error(t('limits.capacityUnavailable'));
        }
      } else if (total > maxSessions) {
        throw new Error(
          t('limits.totalExceedsDeployment', { total, maxSessions }),
        );
      }
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
        const data = readBackendErrorData(err);
        const code =
          err instanceof BackendApiError ? err.code : pickString(data, 'code');
        if (code === 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT') {
          onRefreshDeploymentLimits();
          if (
            typeof data?.total === 'number' &&
            typeof data.maxSessions === 'number'
          ) {
            throw new Error(
              t('limits.totalExceedsDeployment', {
                total: data.total,
                maxSessions: data.maxSessions,
              }),
              { cause: err },
            );
          }
        }
        if (code === 'SANDBOX_CAPACITY_UNAVAILABLE') {
          onRefreshDeploymentLimits();
          throw new Error(t('limits.capacityUnavailable'), { cause: err });
        }
        console.error('[sandboxQuota save]', err);
        throw new Error(t('limits.saveFailed'), { cause: err });
      }
    },
    [
      maxSessions,
      onRefreshDeploymentLimits,
      organizationId,
      savedConfig,
      savedTotal,
      t,
      upsertMutation,
    ],
  );

  const editor = useFormEditor<SandboxQuotaConfig>({
    data: savedConfig,
    schema,
    save,
  });
  const values = useWatch({ control: editor.form.control });
  const parsed = schema.safeParse(values);
  const total = parsed.success ? sandboxQuotaTotal(parsed.data) : undefined;
  const exceedsDeployment =
    total !== undefined && maxSessions !== undefined && total > maxSessions;
  // Without a readable ceiling, a total that does not grow beyond the saved
  // one is still saveable (see `save`); only raising it needs the capacity.
  const withinSaved =
    total !== undefined && savedTotal !== undefined && total <= savedTotal;
  const raisesWithoutCapacity =
    total !== undefined &&
    maxSessions === undefined &&
    !deploymentLimitsLoading &&
    !withinSaved;
  const totalError = exceedsDeployment
    ? t('limits.totalExceedsDeployment', { total, maxSessions })
    : raisesWithoutCapacity
      ? t('limits.capacityUnavailable')
      : undefined;
  const totalSaveable =
    total !== undefined &&
    (maxSessions !== undefined
      ? !exceedsDeployment
      : !deploymentLimitsLoading && withinSaved);

  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(
    { ...editor, isValid: editor.isValid && totalSaveable },
    { enabled: canEdit && savedConfig !== undefined },
  );

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
                        id={`${FORM_ID}-${field}`}
                        aria-label={t(`quota.budgets.${budget}`)}
                        aria-describedby={
                          totalError ? TOTAL_ERROR_ID : TOTAL_ID
                        }
                        isInvalid={exceedsDeployment}
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
          <SettingsFieldRow
            className="border-border border-t"
            label={<span id={`${TOTAL_ID}-label`}>{t('limits.total')}</span>}
            description={t('limits.totalHint')}
          >
            <div className="flex flex-col gap-2">
              <output
                id={TOTAL_ID}
                htmlFor={QUOTA_FIELDS.map(
                  ({ field }) => `${FORM_ID}-${field}`,
                ).join(' ')}
                aria-labelledby={`${TOTAL_ID}-label`}
                // The alert below carries the total while it is in error;
                // announcing the output as well would read every keystroke
                // twice.
                aria-live={totalError === undefined ? 'polite' : 'off'}
                aria-atomic="true"
                className="text-lg font-semibold tabular-nums"
              >
                {t('limits.totalValue', {
                  total: total ?? t('capacity.unknownValue'),
                  maxSessions: maxSessions ?? t('capacity.unknownValue'),
                })}
              </output>
              {totalError ? (
                <p
                  id={TOTAL_ERROR_ID}
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {totalError}
                </p>
              ) : deploymentLimitsLoading ? (
                <p role="status" className="text-muted-foreground text-sm">
                  {t('limits.capacityLoading')}
                </p>
              ) : null}
            </div>
          </SettingsFieldRow>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
