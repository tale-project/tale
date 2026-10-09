import { Avatar } from '@tale/ui/avatar';
import { Badge } from '@tale/ui/badge';
import { THREAD_LIST_CLASS } from '@tale/ui/thread/layout';
import { ThreadDayDivider } from '@tale/ui/thread/thread-day-divider';
import {
  ThreadEvent,
  ThreadEventActor,
  ThreadEventGroup,
} from '@tale/ui/thread/thread-event';
import { ThreadMessage } from '@tale/ui/thread/thread-message';
import { ThreadTime } from '@tale/ui/thread/thread-time';
import { CircleDot, History, UserRound } from 'lucide-react';

/** Tuesday, September 29, 2026, in the reader's time zone. */
const day = (hour: number, minute: number) =>
  new Date(2026, 8, 29, hour, minute).getTime();

export default function ThreadBasic() {
  return (
    <div className="w-full max-w-2xl">
      <ThreadDayDivider sticky={false}>Tuesday, September 29</ThreadDayDivider>
      <ol className={THREAD_LIST_CLASS}>
        <li>
          <ThreadMessage
            avatar={<Avatar kind="person" name="Ada Lovelace" size="sm" />}
            author="Ada Lovelace"
            time={<ThreadTime value={day(9, 12)} />}
          >
            Please start with the comparison table; the FAQ can wait.
          </ThreadMessage>
        </li>
        <li>
          <ThreadEvent
            icon={UserRound}
            time={<ThreadTime value={day(9, 13)} />}
          >
            Assignee changed: Unassigned → Pricing agent ·{' '}
            <ThreadEventActor>Ada Lovelace</ThreadEventActor>
          </ThreadEvent>
        </li>
        <li>
          <ThreadMessage
            avatar={<Avatar kind="agent" name="Pricing agent" size="sm" />}
            author="Pricing agent"
            badge={
              <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                Agent
              </Badge>
            }
            time={<ThreadTime value={day(10, 40)} />}
            clampHeight={120}
          >
            <p>
              I rebuilt the comparison as one table and moved the plan cards
              above it. The table groups features into Collaboration, Automation
              and Security instead of one long list.
            </p>
            <p className="mt-3">
              The FAQ moved below the table and collapses by default. Every
              feature row is one line now; the longer explanations moved into
              tooltips. German and French strings are updated too.
            </p>
            <p className="mt-3">
              Open points: the annual toggle needs a decision, legal has to
              confirm the VAT note, and the sticky header needs a check in older
              Safari versions.
            </p>
          </ThreadMessage>
        </li>
        <li>
          <ThreadMessage variant="own" time={<ThreadTime value={day(11, 2)} />}>
            Looks great. Can you check the toggle on a phone too?
          </ThreadMessage>
        </li>
        <li>
          <ThreadEventGroup
            icon={History}
            summary="3 updates · Ada Lovelace, Pricing agent"
            time={<ThreadTime value={day(11, 5)} />}
          >
            <ThreadEvent
              as="li"
              icon={CircleDot}
              time={<ThreadTime value={day(11, 5)} />}
            >
              Priority changed: Medium → High
            </ThreadEvent>
            <ThreadEvent
              as="li"
              icon={CircleDot}
              time={<ThreadTime value={day(11, 5)} />}
            >
              Labels changed: Design, Web
            </ThreadEvent>
            <ThreadEvent
              as="li"
              icon={CircleDot}
              time={<ThreadTime value={day(11, 5)} />}
            >
              Status changed: To do → In progress
            </ThreadEvent>
          </ThreadEventGroup>
        </li>
      </ol>
    </div>
  );
}
