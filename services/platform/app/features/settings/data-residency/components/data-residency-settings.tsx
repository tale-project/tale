'use client';

/**
 * Unified data-residency settings.
 *
 * One page, two access levels of the SAME surface — not two pages:
 *
 *   - Organization sections first (knowledge database, embedding model, object
 *     storage): editable by an org admin (`write orgSettings`), read-only with
 *     a stated reason otherwise. They sit inside one `EditorGroup`, so their
 *     changes batch through the settings header's shared Discard/Save cluster
 *     (the unified editor contract); Test/Remove/backfill stay instant
 *     actions. The per-org configs live under `$TALE_CONFIG_DIR/<org>/
 *     {knowledge,object-storage}/`, which stays the source of truth on disk.
 *
 * There is no deployment-wide store section: where the deployment's default
 * data lives is environment-driven (`DATABASE_URL`, `KNOWLEDGE_DATABASE_URL`,
 * `OBJECT_STORE_*`) and set at deploy time, never from this page.
 *
 * Read-only sections render the stored coordinates as native read-only fields
 * (conveyed to assistive tech, not by disabled/color alone) and the on/off
 * state as a status badge; write-only credentials are never shown to a viewer.
 *
 * Strings live under `settings.dataResidency.*` (shared connection vocabulary +
 * `orgKnowledge.*` / `orgEmbedding.*` / `orgStorage.*` for the org sections),
 * plus `navigation.dataResidency`, `metadata.dataResidency`, and
 * `accessDenied.dataResidency` across en/de/fr (de-CH inherits de). Code
 * tokens (env vars, shell commands, bucket names) stay English in every
 * locale.
 *
 * `api.deployment.*` / `api.knowledge.*` resolve after `convex codegen` (runs
 * on dev/deploy).
 */

import { Skeletonize } from '@tale/ui/skeleton-context';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { EditorGroup } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import {
  useOrgKnowledgeConnection,
  useOrgKnowledgeEmbedding,
  useOrgObjectStorageConnection,
} from '../hooks/queries';
import { mapOrgResidencyError } from '../org-residency-errors';
import { OrgEmbeddingSection } from './org-embedding-section';
import { OrgKnowledgeSection } from './org-knowledge-section';
import { OrgStorageSection } from './org-storage-section';

export function DataResidencySettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const knowledgeQuery = useOrgKnowledgeConnection(organizationId);
  const embeddingQuery = useOrgKnowledgeEmbedding(organizationId);
  const storageQuery = useOrgObjectStorageConnection(organizationId);

  // Viewing is open to any organization admin (`read orgSettings`); editing
  // needs `write orgSettings`.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('dataResidency')} />;
  }

  const canWriteOrg = !abilityLoading && ability.can('write', 'orgSettings');

  // A failed read must not fall through to a blank, default-looking form — that
  // would imply "nothing configured" when the truth is unknown. Each section
  // reports its own read failure inline.
  const knowledgeReadError = knowledgeQuery.isError
    ? mapOrgResidencyError(knowledgeQuery.error, t)
    : undefined;
  const embeddingReadError = embeddingQuery.isError
    ? mapOrgResidencyError(embeddingQuery.error, t)
    : undefined;
  const storageReadError = storageQuery.isError
    ? mapOrgResidencyError(storageQuery.error, t)
    : undefined;

  return (
    <Skeletonize
      loading={
        abilityLoading ||
        knowledgeQuery.isPending ||
        embeddingQuery.isPending ||
        storageQuery.isPending
      }
    >
      <SettingsPage>
        <EditorGroup>
          <OrgKnowledgeSection
            organizationId={organizationId}
            view={knowledgeQuery.data}
            readError={knowledgeReadError}
            readOnly={!canWriteOrg}
          />
          <OrgEmbeddingSection
            organizationId={organizationId}
            view={embeddingQuery.data}
            readError={embeddingReadError}
            readOnly={!canWriteOrg}
            sharedDatabase={knowledgeQuery.data?.configured !== true}
          />
          <OrgStorageSection
            organizationId={organizationId}
            view={storageQuery.data}
            readError={storageReadError}
            readOnly={!canWriteOrg}
          />
        </EditorGroup>
      </SettingsPage>
    </Skeletonize>
  );
}
