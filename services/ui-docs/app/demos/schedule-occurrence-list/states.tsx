import type { ScheduleOccurrence } from '@tale/ui/recurrence-schedule';
import { ScheduleOccurrenceList } from '@tale/ui/schedule-occurrence-list';

/**
 * What a host's schedule engine returns for "every hour" in Zurich on
 * October 25, 2026, when the clocks go back from 03:00 to 02:00: 02:00 runs
 * twice, an hour apart, and both runs are marked. The instants are fixed so
 * the example reads the same for everyone.
 */
const REPEATED_HOUR: ScheduleOccurrence[] = [
  { at: Date.UTC(2026, 9, 24, 23, 0), timeZone: 'Europe/Zurich' },
  {
    at: Date.UTC(2026, 9, 25, 0, 0),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'repeatedHour', interval: true },
  },
  {
    at: Date.UTC(2026, 9, 25, 1, 0),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'repeatedHour', interval: true },
  },
  { at: Date.UTC(2026, 9, 25, 2, 0), timeZone: 'Europe/Zurich' },
];

export default function ScheduleOccurrenceListStates() {
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <ScheduleOccurrenceList
          occurrences={REPEATED_HOUR}
          muted
          label="Would run at"
          referenceYear={2026}
          viewerTimeZone="Europe/Zurich"
        />
        <p className="text-muted-foreground text-xs">
          The schedule is turned off, so none of these runs will start.
        </p>
      </div>
      <ScheduleOccurrenceList occurrences={[]} viewerTimeZone="Europe/Zurich" />
    </div>
  );
}
