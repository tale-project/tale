'use client';

import { LinkButton } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Settings } from 'lucide-react';

import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

/**
 * Guidance block for the failed-indexing dialog when the cause is the
 * organization having no embedding model configured
 * (`ragErrorCode === RAG_ERROR_EMBEDDING_NOT_CONFIGURED`): names the fix and
 * deep-links Settings → Data residency for members who can open org settings
 * (the same `orgSettings` gate the route itself uses), or points everyone else
 * at an admin. Mirrors the chat error's `ProviderKeyErrorAction`.
 */
export function EmbeddingNotConfiguredGuidance() {
  const { t } = useT('documents');
  const organizationId = useOrganizationId();
  const canOpenOrgSettings = useAbility().can('read', 'orgSettings');

  return (
    <Stack gap={2} className="mt-3">
      <Text>{t('rag.dialog.failed.embeddingNotConfigured.hint')}</Text>
      {canOpenOrgSettings && organizationId ? (
        <LinkButton
          variant="secondary"
          size="sm"
          icon={Settings}
          href="/dashboard/$id/settings/data-residency"
          params={{ id: organizationId }}
          className="w-fit gap-1.5"
        >
          {t('rag.dialog.failed.embeddingNotConfigured.configureCta')}
        </LinkButton>
      ) : (
        <Text variant="muted">
          {t('rag.dialog.failed.embeddingNotConfigured.askAdmin')}
        </Text>
      )}
    </Stack>
  );
}
