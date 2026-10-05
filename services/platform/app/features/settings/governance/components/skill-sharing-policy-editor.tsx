'use client';

import {
  ORG_WIDE_AUDIENCE_MODES,
  type OrgWideAudienceMode,
  type SkillSharingConfig,
  skillOrgWideModeOf,
  skillSharingConfigSchema,
} from '@tale/shared/schemas/governance';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Select } from '@tale/ui/select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { withGovernancePolicyReadBoundary } from './policy-read-boundary';

interface SkillSharingPolicyEditorProps {
  organizationId: string;
}

const FORM_ID = 'governance-skill-sharing-form';

// A missing file is `everyone` — the behaviour before the policy existed —
// so the select shows the mode actually in force, not an empty choice.
const parseConfig = createConfigParser(
  skillSharingConfigSchema,
  (): SkillSharingConfig => ({ orgWide: 'everyone' }),
);

interface SkillSharingForm {
  orgWide: OrgWideAudienceMode;
}

const formSchema = z.object({ orgWide: z.enum(ORG_WIDE_AUDIENCE_MODES) });

// =============================================================================
// Who may share a skill with the whole organization. Owners and admins always
// may, and so may a member granted `tale:skills.publish` under Competences;
// sharing with one's own teams is never governed here. Tightening the mode
// narrows no skill that is already organization-wide. Saved through the
// settings header's Save/Discard cluster like the page's other editors.
// =============================================================================
function SkillSharingPolicyEditorContent({
  organizationId,
}: SkillSharingPolicyEditorProps) {
  const { t } = useT('governance');
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'skill_sharing',
  );
  const { mutateAsync: upsertPolicy } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  const data = useMemo<SkillSharingForm>(
    () => ({ orgWide: skillOrgWideModeOf(parseConfig(policy?.config)) }),
    [policy?.config],
  );

  const save = useCallback(
    async (values: SkillSharingForm) => {
      try {
        await upsertPolicy({
          organizationId,
          policyType: 'skill_sharing',
          config: { orgWide: values.orgWide } satisfies SkillSharingConfig,
        });
      } catch (err) {
        console.error('[skillSharing save]', err);
        throw new Error(t('skillSharing.saveFailed'), { cause: err });
      }
    },
    [organizationId, t, upsertPolicy],
  );

  const editor = useFormEditor<SkillSharingForm>({
    data,
    schema: formSchema,
    save,
  });
  // Read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit });

  const orgWide = editor.form.watch('orgWide');

  return (
    <Skeletonize loading={isLoading} label={t('skillSharing.title')}>
      <SettingsSection
        title={t('skillSharing.title')}
        description={t('skillSharing.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <SettingsFieldList>
              <SettingsFieldRow
                label={t('skillSharing.label')}
                description={t('skillSharing.labelHint')}
              >
                <Select
                  aria-label={t('skillSharing.label')}
                  disabled={!canEdit}
                  value={orgWide}
                  onValueChange={(value) => {
                    const mode = formSchema.shape.orgWide.safeParse(value);
                    if (!mode.success) return;
                    editor.form.setValue('orgWide', mode.data, {
                      shouldDirty: true,
                    });
                  }}
                  options={ORG_WIDE_AUDIENCE_MODES.map((mode) => ({
                    value: mode,
                    label: t(`skillSharing.modes.${mode}`),
                  }))}
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}

export const SkillSharingPolicyEditor = withGovernancePolicyReadBoundary(
  SkillSharingPolicyEditorContent,
  'skill_sharing',
);
