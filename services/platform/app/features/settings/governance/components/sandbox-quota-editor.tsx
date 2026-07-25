'use client';

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
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_SANDBOX_QUOTA,
  type SandboxQuotaConfig,
  sandboxQuotaConfigSchema,
} from '@/lib/shared/schemas/governance';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface SandboxQuotaEditorProps {
  organizationId: string;
}

interface SandboxQuotaForm {
  maxSessionsPerOrg: number;
}

const FORM_ID = 'governance-sandbox-quota-form';

const parseConfig = createConfigParser(sandboxQuotaConfigSchema, () => ({
  ...DEFAULT_SANDBOX_QUOTA,
}));

// =============================================================================
// Per-org sandbox session quota. Edits the per-org USER-agent session cap; the
// per-thread / workflow / render session budgets are config/API-tuned and
// preserved on save. No instant-save toggle since the quota always applies. The
// deployment-wide host cap is spawner env — this is the per-tenant slice.
// Mirrors the other policy editors: owns its fetch, the form controller, and the
// loading state, rendering the real layout once inside `<Skeletonize>`.
// =============================================================================
export function SandboxQuotaEditor({
  organizationId,
}: SandboxQuotaEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'sandbox_quota',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);
  const cannotManage = ability.cannot('write', 'orgSettings');
  const canEdit = !cannotManage;

  const schema = useMemo(
    () =>
      z.object({
        maxSessionsPerOrg: z
          .number()
          .int()
          .min(1, t('sandboxQuota.invalidSessions'))
          .max(500, t('sandboxQuota.invalidSessions')),
      }),
    [t],
  );

  const data = useMemo<SandboxQuotaForm | undefined>(() => {
    if (isLoading) return undefined;
    return {
      maxSessionsPerOrg: savedConfig.maxSessionsPerOrg,
    };
  }, [isLoading, savedConfig]);

  const save = useCallback(
    async (values: SandboxQuotaForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'sandbox_quota',
          config: {
            // Preserve the per-thread / workflow / render session caps (not in
            // this editor — tuned via config/API); only the user session cap
            // below is edited here.
            ...savedConfig,
            maxSessionsPerOrg: values.maxSessionsPerOrg,
          } satisfies SandboxQuotaConfig,
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('sandboxQuota.saved'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('sandboxQuota.saveFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [organizationId, savedConfig, t, toast, upsertMutation],
  );

  const editor = useFormEditor<SandboxQuotaForm>({ data, schema, save });
  // Saving runs through the settings header's global Save/Discard cluster;
  // read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit });

  const {
    register,
    formState: { errors },
  } = editor.form;

  return (
    <Skeletonize loading={isLoading} label={t('sandboxQuota.title')}>
      <SettingsSection
        title={t('sandboxQuota.title')}
        description={t('sandboxQuota.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <SettingsFieldList>
              <SettingsFieldRow
                label={t('sandboxQuota.maxSessions')}
                description={t('sandboxQuota.maxSessionsHint')}
              >
                <Input
                  aria-label={t('sandboxQuota.maxSessions')}
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  wrapperClassName="w-full"
                  errorMessage={errors.maxSessionsPerOrg?.message}
                  {...register('maxSessionsPerOrg', { valueAsNumber: true })}
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
