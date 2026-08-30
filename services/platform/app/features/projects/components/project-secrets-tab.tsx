'use client';

/**
 * Per-project environment editor — the project-scoped surface of the SAME shared
 * `EnvVarListEditor` the agent, workflow/automation, and personal env editors
 * use, so every environment surface is one component (labelled "Environment").
 * Project secrets are write-only (values never leave the server), so the editor
 * runs in `forceSecret` mode: a flat KEY = value list where every row is
 * encrypted and masked. Saving upserts via `setProjectSecret`; removing a row
 * deletes it. Values are never returned to the client, so a stored secret shows
 * a mask and the field clears for a clean re-type.
 */
import { Alert } from '@tale/ui/alert';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { ShieldAlert } from 'lucide-react';

import {
  EnvVarListEditor,
  type LoadedEnvVar,
} from '@/app/components/env/env-var-list-editor';
import { ContentArea } from '@/app/components/layout/content-area';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import {
  useDeleteProjectSecret,
  useProjectSecrets,
  useSetProjectSecret,
} from '../hooks/secrets';

export function ProjectSecretsTab({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useT('projectSecrets');
  const {
    secrets,
    isLoading,
    isError,
    error: secretsError,
  } = useProjectSecrets(projectId);
  const setSecret = useSetProjectSecret();
  const deleteSecret = useDeleteProjectSecret();

  // The tab is gated on `project.canAdminister` in the project layout, but a
  // non-admin can still reach this page via a direct URL. Surface the backend's
  // structured access error as a translated message instead of a misleading
  // empty editor.
  const accessErrorCode = isError ? backendErrorCode(secretsError) : undefined;
  const isAccessDenied =
    accessErrorCode === 'PROJECT_FORBIDDEN' ||
    accessErrorCode === 'PROJECT_NOT_FOUND' ||
    accessErrorCode === 'UNAUTHENTICATED';

  if (isAccessDenied) {
    return (
      <ContentArea variant="narrow" gap={6}>
        <StickySectionHeader
          title={t('title')}
          description={t('description')}
        />
        <Alert
          variant="destructive"
          icon={ShieldAlert}
          title={t('errors.accessDeniedTitle')}
          description={
            accessErrorCode === 'PROJECT_NOT_FOUND'
              ? t('errors.PROJECT_NOT_FOUND')
              : t('errors.PROJECT_FORBIDDEN')
          }
        />
      </ContentArea>
    );
  }

  // Every stored secret is a masked, write-only row — the query returns only the
  // name, never the value — so the shared editor runs in forceSecret mode.
  const rows: LoadedEnvVar[] = secrets.map((secret) => ({
    key: secret.name,
    isSecret: true,
  }));

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader title={t('title')} description={t('description')} />
      <Alert
        variant="warning"
        icon={ShieldAlert}
        title={t('agentAccessTitle')}
        description={t('agentAccessBody')}
      />
      <EnvVarListEditor
        forceSecret
        rows={rows}
        isLoading={isLoading}
        onSet={async ({ key, value }) => {
          await setSecret.mutateAsync({
            organizationId,
            projectId,
            name: key,
            value,
          });
        }}
        onDelete={async (key) => {
          await deleteSecret.mutateAsync({
            organizationId,
            projectId,
            name: key,
          });
        }}
      />
    </ContentArea>
  );
}
