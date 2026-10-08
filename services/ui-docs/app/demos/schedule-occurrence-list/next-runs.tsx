import type { ScheduleOccurrence } from '@tale/ui/recurrence-schedule';
import { ScheduleOccurrenceList } from '@tale/ui/schedule-occurrence-list';

/**
 * What a host's schedule engine returns for "daily at 02:30" in Zurich,
 * around the two clock changes of 2026: on March 29, 02:30 does not exist
 * and the start moves to 03:30; on October 25, 02:30 happens twice and the
 * start runs at the first. The instants are fixed so the example reads the
 * same for everyone.
 */
const STARTS: ScheduleOccurrence[] = [
  { at: Date.UTC(2026, 2, 28, 1, 30), timeZone: 'Europe/Zurich' },
  {
    at: Date.UTC(2026, 2, 29, 1, 30),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'shiftedForward', wallTime: '02:30' },
  },
  {
    at: Date.UTC(2026, 9, 25, 0, 30),
    timeZone: 'Europe/Zurich',
    clockChange: { kind: 'repeatedHour', interval: false },
  },
];

/** Every 15 minutes in New York, as a compact popover list shows it. */
const GRID: ScheduleOccurrence[] = [0, 15, 30].map((minute) => ({
  at: Date.UTC(2026, 9, 13, 13, minute),
  timeZone: 'America/New_York',
}));

export default function ScheduleOccurrenceListNextRuns() {
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <ScheduleOccurrenceList
        occurrences={STARTS}
        referenceYear={2026}
        viewerTimeZone="America/New_York"
      />
      <div className="border-border w-72 max-w-full rounded-lg border p-3">
        <ScheduleOccurrenceList
          occurrences={GRID}
          variant="compact"
          count={3}
          referenceYear={2026}
          viewerTimeZone="Europe/Zurich"
        />
      </div>
    </div>
  );
}
