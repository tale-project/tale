'use client';

import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

/**
 * What a failed run reported in its own words — the harness's error, a
 * spawner's answer, a provider's payload — folded under "What the run
 * reported". Those words are English and often name hosts, sessions and
 * settings only an operator can change, so they never lead: the run's failure
 * class does (`lib/shared/task-run-failure.ts`), and the folded words stay one
 * click away for the Admin or operator they are shown to.
 */
export function TaskAgentRunReported({ error }: { error: string }) {
  const { t } = useT('tasks');
  return (
    <CollapsibleDetails variant="compact" summary={t('agentRun.reported')}>
      <Text
        as="p"
        variant="muted"
        className="bg-muted/50 mt-1 rounded-md px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap"
      >
        {error}
      </Text>
    </CollapsibleDetails>
  );
}
