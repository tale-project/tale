'use client';

/**
 * Per-project environment editor — the project-scoped surface of the SAME shared
 * `EnvVarListEditor` the agent, workflow/automation, and personal env editors
 * use, so every environment surface is one component (labelled "Environment").
 * Project secrets are write-only (values never leave the server), so the editor
 * runs in `forceSecret` mode: a flat KEY = value list where every row is
 * encrypted and masked. Saving upserts via `setProjectSecret`; removing a row
 * deletes it. Values are never returned to the client, so a stored secret shows
 * a mask and the field clears for a clean re-type. The editor reports a failed
 * save in its own toast, so a write rejects with the sentence that toast shows.
 */
import { Alert } from '@tale/ui/alert';
import { ContentArea } from '@tale/ui/content-area';
import {
  EnvVarListEditor,
  type LoadedEnvVar,
} from '@tale/ui/env-var-list-editor';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { ShieldAlert } from 'lucide-react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useProject } from '../hooks/queries';
import {
  useDeleteProjectSecret,
  useProjectSecrets,
  useSetProjectSecret,
} from '../hooks/secrets';
import { ProjectReadOnlyBanner } from './project-read-only-banner';
import { ProjectSecretsLayout } from './project-secrets-layout';

export function ProjectSecretsTab({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useT('projectSecrets');
  const { t: tCommon } = useT('common');
  const {
    secrets,
    isLoading,
    isError,
    error: secretsError,
  } = useProjectSecrets(projectId);
  const setSecret = useSetProjectSecret();
  const deleteSecret = useDeleteProjectSecret();
  // An archived project is read-only for everyone, its secrets included:
  // the backend refuses every write with PROJECT_ARCHIVED, so the editor's
  // write controls are gated here too (restore the project first).
  const { project } = useProject(projectId);
  const isArchived = project?.archivedAt !== undefined;

  // The tab is gated on `project.canAdminister` in the project layout, but a
  // non-admin can still reach this page via a direct URL. Surface the backend's
  // structured access error as a translated message instead of a misleading
  // empty editor.
  const accessErrorCode = isError ? backendErrorCode(secretsError) : undefined;
  const isAccessDenied =
    accessErrorCode === 'PROJECT_FORBIDDEN' ||
    accessErrorCode === 'PROJECT_NOT_FOUND' ||
    accessErrorCode === 'UNAUTHORIZED';

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

  // What the editor's failure toast says under its title: a refusal's own
  // words (a lapsed session's "Your session has ended…"), or the generic line
  // for a fault. Never the thrown error's message: a refusal serializes its
  // payload there.
  const saveFailure = (error: unknown) =>
    new Error(failureDetail(error) ?? tCommon('errors.generic'), {
      cause: error,
    });

  return (
    <ProjectSecretsLayout>
      {isArchived ? <ProjectReadOnlyBanner reason="archived" /> : null}
      <EnvVarListEditor
        forceSecret
        rows={rows}
        isLoading={isLoading}
        disabled={isArchived}
        onSet={async ({ key, value }) => {
          try {
            await setSecret.mutateAsync({
              organizationId,
              projectId,
              name: key,
              value,
            });
          } catch (error) {
            throw saveFailure(error);
          }
        }}
        onDelete={async (key) => {
          try {
            await deleteSecret.mutateAsync({
              organizationId,
              projectId,
              name: key,
            });
          } catch (error) {
            throw saveFailure(error);
          }
        }}
      />
    </ProjectSecretsLayout>
  );
}
