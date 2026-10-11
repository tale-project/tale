import { toast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { useT } from '@/lib/i18n/client';

import { rawDocumentOf } from '../lib/draft-document';
import { automationErrorMessage } from '../lib/errors';
import { downloadYaml, sourceFileName, yamlSource } from '../lib/yaml-source';

/**
 * Saves one version of an automation as the YAML its Source view shows,
 * named after the automation and the version (`weekly-digest-v3.yml`). The
 * version is read through the cache the pages share; a read that fails is
 * said in a toast.
 */
export function useDownloadVersion(
  organizationId: string,
  automationSlug: string,
): (version: number) => void {
  const { t } = useT('automations');
  const queryClient = useQueryClient();
  return useCallback(
    (version: number) => {
      ensureAdaptedQueryData(queryClient, 'automations/queries:getAutomation', {
        organizationId,
        name: automationSlug,
        version,
      })
        .then((detail) => {
          const document = rawDocumentOf(detail?.document);
          if (document === null) {
            throw new Error(`v${version} has no document to download`);
          }
          downloadYaml(
            yamlSource(document),
            sourceFileName(automationSlug, version, false),
          );
        })
        .catch((error: unknown) => {
          console.warn(
            '[automations] a version could not be downloaded',
            error,
          );
          toast({
            title: t('versions.actions.downloadFailed', { version }),
            description: automationErrorMessage(error),
            variant: 'destructive',
          });
        });
    },
    [queryClient, organizationId, automationSlug, t],
  );
}
