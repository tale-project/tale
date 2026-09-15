/**
 * What an UNPINNED model pick would run on right now — the runtime's own
 * resolution, asked per lane so the display can never drift from what a run
 * would do: the automation agent node asks the workflow resolver (two-pass
 * walk), the project-agent dialog asks the task resolver (direct-only walk).
 * Disabled entirely for pinned picks; the answer is a snapshot the wording
 * must present as "currently". "Currently" follows the org's credentials:
 * the answer keys under their entity, so a credential write re-resolves it.
 */

import { useActionQuery } from '@/app/hooks/use-action-query';
import { backendKey } from '@/app/lib/backend/query-keys';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

/** Which lane's resolver answers — they intentionally differ unpinned. */
export type ServingPreviewLane = 'workflow' | 'task';

export interface ServingPreviewArgs {
  organizationId: string;
  model: string;
  harness: string;
}

export function useUnpinnedServingPreview(
  lane: ServingPreviewLane,
  args: ServingPreviewArgs | undefined,
) {
  const func =
    lane === 'workflow'
      ? 'automations/serving_preview:previewUnpinnedAgentServing'
      : 'tasks/serving_preview:previewUnpinnedTaskServing';
  return useActionQuery(
    args === undefined
      ? ['unpinned-serving-preview', lane, null]
      : backendKey(
          args.organizationId,
          PROVIDER_CREDENTIAL_HINT_ENTITY,
          'serving-preview',
          lane,
          args.model,
          args.harness,
        ),
    func,
    args ?? { organizationId: '', model: '', harness: '' },
    { enabled: args !== undefined },
  );
}
