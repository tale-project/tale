'use client';

/**
 * Personal (per-user) env/secret editor, backed by the `userEnv` store. Renders
 * the SAME shared `EnvVarListEditor` the agent + workflow/automation env editors
 * use, inside the shared env-page chrome (max-w-3xl ContentArea + SectionHeader)
 * — so all three environment surfaces are identical.
 */
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';

import {
  EnvVarListEditor,
  type LoadedEnvVar,
} from '@/app/components/env/env-var-list-editor';
import { ContentArea } from '@/app/components/layout/content-area';
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

  return (
    <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
      <SectionHeader
        title={t('page.title')}
        description={t('page.description')}
      />
      <Text className="text-muted-foreground text-sm">{t('page.note')}</Text>
      <EnvVarListEditor
        rows={vars as LoadedEnvVar[] | undefined}
        isLoading={vars === undefined}
        onSet={async ({ key, value, isSecret }) => {
          await upsert({ organizationId, key, value, isSecret });
        }}
        onDelete={async (key) => {
          await deleteVar({ organizationId, key });
        }}
      />
    </ContentArea>
  );
}
