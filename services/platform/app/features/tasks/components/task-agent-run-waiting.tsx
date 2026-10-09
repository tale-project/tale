'use client';

/**
 * What a project agent's waiting run says about its wait — one short state
 * per reason where "Queued" would stand, and the sentence that explains it.
 * The task's Run row and its timeline row both read it from here, so the two
 * never word the same wait differently. When every one of the
 * organization's agent workers is busy, an Owner or Admin also gets the way
 * to raise that limit (Settings > Sandboxes).
 */

import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import type { AgentRunWaitingReason } from '@/lib/shared/agent-run-waiting';

/** A waiting run as its reads carry it: parked for room, and why when the
 * park kept a reason. */
interface WaitingRun {
  status: string;
  waitingForCapacity?: boolean;
  waitingReason?: AgentRunWaitingReason;
}

/** Whether the run waits for room rather than being merely queued. */
export function isAgentRunWaiting(run: WaitingRun): boolean {
  return run.status === 'queued' && run.waitingForCapacity === true;
}

/** The reason a waiting run's copy is keyed by (`agentRun.waiting.*`,
 * `agentRun.waitingWhy.*`): `unknown` for a wait that kept none. */
export function waitingCopyKey(
  reason: AgentRunWaitingReason | undefined,
): AgentRunWaitingReason | 'unknown' {
  return reason ?? 'unknown';
}

export function TaskAgentRunWaitingNote({
  organizationId,
  reason,
}: {
  organizationId: string;
  reason: AgentRunWaitingReason | undefined;
}) {
  const { t } = useT('tasks');
  const ability = useAbility();
  // The limit is the organization's sandbox policy: only those who may
  // change it are sent to it.
  const canRaise =
    reason === 'org_limit' && ability.can('write', 'orgSettings');
  return (
    <Text variant="caption" className="text-muted-foreground text-pretty">
      {t(`agentRun.waitingWhy.${waitingCopyKey(reason)}`)}
      {canRaise ? (
        <>
          {' '}
          <Link
            to="/dashboard/$id/settings/sandboxes"
            params={{ id: organizationId }}
            className="text-foreground focus-visible:ring-ring rounded-sm font-medium underline underline-offset-2 focus-visible:ring-1 focus-visible:outline-none"
          >
            {t('agentRun.manageWorkers')}
          </Link>
        </>
      ) : null}
    </Text>
  );
}
