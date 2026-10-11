import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';
import { parseRunStarter } from '@/lib/shared/run-starter';

import { useActorLabel } from './use-actor-label';

/** The two facts a starter label is read from — the door that started the
 * run and, for a trigger, which kind fired. */
export interface RunStarterFacts {
  startedBy: string;
  startedVia?: 'schedule' | 'webhook' | 'event' | undefined;
}

/**
 * The words for who or what started a run. `startedBy` names a DOOR
 * (`user:<id>`, `api-key:<id>`, `trigger:<id>`), which is addressing, never
 * a label: a person as {@link useActorLabel} names them, with "(API)"
 * beside one who started it with a key, and the trigger's kind for a
 * binding. A starter this reader cannot name — the directory has not
 * answered yet, or the value names nobody — reads as not recorded.
 */
export function useRunStarterLabel(
  organizationId: string,
): (run: RunStarterFacts) => string {
  const { t } = useT('automations');
  const actorLabel = useActorLabel(organizationId);

  return useCallback(
    (run: RunStarterFacts): string => {
      if (parseRunStarter(run.startedBy).kind === 'trigger') {
        return t(`runs.starter.${run.startedVia ?? 'trigger'}`);
      }
      const actor = actorLabel(run.startedBy);
      switch (actor.kind) {
        case 'you':
          return t(actor.api ? 'runs.starter.youApi' : 'runs.starter.you');
        case 'member':
          return t(actor.api ? 'runs.starter.apiKey' : 'runs.starter.member', {
            name: actor.name,
          });
        case 'former':
          return t(
            actor.api
              ? 'runs.starter.formerMemberApi'
              : 'runs.starter.formerMember',
          );
        default:
          return t('runs.starter.unknown');
      }
    },
    [actorLabel, t],
  );
}
