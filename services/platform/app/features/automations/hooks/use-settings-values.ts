'use client';

import { useQuery } from '@tanstack/react-query';
import { getFunctionName } from 'convex/server';

import { useConvexAuth } from '@/app/hooks/use-convex-auth';
import { useConvexClient } from '@/app/hooks/use-convex-client';
import { ACTION_QUERY_ADAPTERS } from '@/app/lib/backend/convex-adapters';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import {
  type AutomationSettings,
  isUploadsForm,
} from '@/lib/shared/schemas/automation_settings';

/** What each declared settings file currently holds, keyed by file name. A
 *  file that does not exist yet reads as `{}` (the action's own contract). */
export type SettingsValuesByFile = Record<string, Record<string, string>>;

/**
 * The values behind one automation's settings declaration, read once per
 * (organization, project, folder, file set) and cached.
 *
 * A query rather than a mount effect: the create-task gate and the settings
 * form both need the same files — as one query key they share a single read,
 * and neither can cancel the other's request the way two effects racing on a
 * re-render would. `staleTime: Infinity` keeps it a deliberate read; a save
 * invalidates the key (see `settingsValuesQueryKey`).
 */
export function settingsValuesQueryKey(
  organizationId: string,
  projectId: Id<'projects'>,
  folder: string,
): readonly unknown[] {
  return ['automation-settings-values', organizationId, projectId, folder];
}

export function useAutomationSettingsValues(
  organizationId: string,
  projectId: Id<'projects'>,
  folder: string | null,
  settings: AutomationSettings | null,
) {
  const client = useConvexClient();
  const readAdapted =
    ACTION_QUERY_ADAPTERS[
      getFunctionName(api.documents.public_actions.readProjectTextValues)
    ] !== undefined;
  const { isAuthenticated } = useConvexAuth();
  // Only FIELD forms own a YAML file; uploads panels read the folder's
  // documents through their own query instead.
  const files = (settings?.forms ?? [])
    .flatMap((form) => (isUploadsForm(form) ? [] : [form.file]))
    .sort();
  return useQuery({
    // The file list rides the key: a redeployed automation that declares
    // another file must not read the previous deployment's cached answer.
    queryKey: [
      ...settingsValuesQueryKey(organizationId, projectId, folder ?? ''),
      files.join('|'),
    ],
    queryFn: async (): Promise<SettingsValuesByFile> => {
      const byFile: SettingsValuesByFile = {};
      await Promise.all(
        files.map(async (fileName) => {
          byFile[fileName] = await client.action(
            api.documents.public_actions.readProjectTextValues,
            {
              organizationId,
              projectId,
              folderName: folder ?? '',
              fileName,
            },
          );
        }),
      );
      return byFile;
    },
    staleTime: Infinity,
    // The adapted lane authenticates with the session cookie and never
    // waits on the Convex socket; the WS gate only matters while this read
    // still rides it.
    enabled:
      folder !== null && files.length > 0 && (readAdapted || isAuthenticated),
  });
}
