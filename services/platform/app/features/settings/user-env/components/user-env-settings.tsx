'use client';

/**
 * Personal (per-user) env/secret editor, backed by the `userEnv` store. Renders
 * the SAME shared `EnvVarListEditor` the agent + workflow/automation env editors
 * use, inside the canonical settings chrome (`SettingsPage` + `SettingsSection`).
 * Save/Discard docks in the settings header via the active-editor registry —
 * like every other settings page — instead of an in-content Save button.
 */
import { Skeletonize } from '@tale/ui/skeleton-context';

import { EnvVarListEditor } from '@/app/components/env/env-var-list-editor';
import { useEnvEditorController } from '@/app/components/env/use-env-editor-controller';
import { useRegisterActiveEditor } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

import { useDeleteMyEnvVar, useUpsertMyEnvVar } from '../hooks/mutations';
import { useMyEnv } from '../hooks/queries';

export function UserEnvSettings() {
  const organizationId = useOrganizationId();
  if (!organizationId) return null;
  return <UserEnvSettingsInner organizationId={organizationId} />;
}

function UserEnvSettingsInner({ organizationId }: { organizationId: string }) {
  const { t } = useT('userEnv');
  const vars = useMyEnv(organizationId);
  const { mutateAsync: upsert } = useUpsertMyEnvVar();
  const { mutateAsync: deleteVar } = useDeleteMyEnvVar();

  const { controller, onEditorState } = useEnvEditorController();
  useRegisterActiveEditor(controller);

  return (
    <Skeletonize loading={vars === undefined}>
      <SettingsPage>
        <SettingsSection
          title={t('page.title')}
          description={
            <>
              {t('page.description')} {t('page.note')}
            </>
          }
        >
          <EnvVarListEditor
            rows={vars}
            isLoading={vars === undefined}
            externalSave
            onEditorState={onEditorState}
            onSet={async ({ key, value, isSecret }) => {
              await upsert({ organizationId, key, value, isSecret });
            }}
            onDelete={async (key) => {
              await deleteVar({ organizationId, key });
            }}
          />
        </SettingsSection>
      </SettingsPage>
    </Skeletonize>
  );
}
