/**
 * What an UNPINNED model pick would run on right now — the runtime's own
 * resolution, asked per lane so the display can never drift from what a run
 * would do: the automation agent node asks the workflow resolver (two-pass
 * walk), the project-agent dialog asks the task resolver (direct-only walk).
 * Disabled entirely for pinned picks; the answer is a snapshot the wording
 * must present as "currently".
 */

import { useActionQuery } from '@/app/hooks/use-action-query';

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
    ['unpinned-serving-preview', lane, args ?? null],
    func,
    args ?? { organizationId: '', model: '', harness: '' },
    { enabled: args !== undefined },
  );
}
