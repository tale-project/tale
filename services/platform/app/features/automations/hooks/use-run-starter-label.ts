import { useCallback } from 'react';

import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useT } from '@/lib/i18n/client';
import { parseRunStarter } from '@/lib/shared/run-starter';

/** The two facts a starter label is read from — the door that started the
 * run and, for a trigger, which kind fired. */
export interface RunStarterFacts {
  startedBy: string;
  startedVia?: 'schedule' | 'webhook' | 'event' | undefined;
}

/**
 * The words for who or what started a run. `startedBy` names a DOOR
 * (`user:<id>`, `api-key:<id>`, `trigger:<id>`), which is addressing, never
 * a label: the member's name (or e-mail) for a person, "you" for the reader,
 * "(API)" beside the key's owner, and the trigger's kind for a binding. A
 * raw id never reaches the page — a member the directory no longer lists
 * reads as a former member, a starter this reader cannot name at all
 * reads as unknown, and a person is left unnamed (an empty label) until
 * the member list has loaded.
 */
export function useRunStarterLabel(
  organizationId: string,
): (run: RunStarterFacts) => string {
  const { t } = useT('automations');
  const { members } = useMembers(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const currentUserId = me?.userId;

  return useCallback(
    (run: RunStarterFacts): string => {
      const starter = parseRunStarter(run.startedBy);
      switch (starter.kind) {
        case 'user':
        case 'api-key': {
          const isApi = starter.kind === 'api-key';
          if (starter.userId === currentUserId) {
            return t(isApi ? 'runs.starter.youApi' : 'runs.starter.you');
          }
          // Nothing is said while the member list loads — better a moment
          // of silence than a flash of "a former member" for someone the
          // directory simply has not answered yet.
          if (members === undefined) return '';
          const member = members.find((m) => m.userId === starter.userId);
          const name = member ? member.displayName || member.email : null;
          if (name === null || name === '' || name === undefined) {
            return t(
              isApi
                ? 'runs.starter.formerMemberApi'
                : 'runs.starter.formerMember',
            );
          }
          return t(isApi ? 'runs.starter.apiKey' : 'runs.starter.member', {
            name,
          });
        }
        case 'trigger':
          return t(`runs.starter.${run.startedVia ?? 'trigger'}`);
        default:
          return t('runs.starter.unknown');
      }
    },
    [currentUserId, members, t],
  );
}
