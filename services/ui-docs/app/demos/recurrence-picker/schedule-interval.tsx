import { RecurrencePicker } from '@tale/ui/recurrence-picker';
import type { ScheduleRule } from '@tale/ui/recurrence-schedule';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { Clock } from 'lucide-react';
import { useState } from 'react';

/** Today in this example: Tuesday, September 29, 2026. */
const TODAY = { year: 2026, month: 9, day: 29, weekday: 2 };

export default function RecurrencePickerScheduleInterval() {
  const format = useRecurrenceFormat();
  const [rule, setRule] = useState<ScheduleRule | null>({
    frequency: 'minutely',
    interval: 15,
    window: {
      weekdays: [1, 2, 3, 4, 5],
      hours: { from: '08:00', to: '18:00' },
    },
  });

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <RecurrencePicker
        granularity="time"
        variant="default"
        align="start"
        icon={Clock}
        label="Check the inbox"
        value={rule}
        reference={TODAY}
        onChange={setRule}
      />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {rule === null ? 'Not scheduled.' : `Saved: ${format.schedule(rule)}.`}
      </p>
    </div>
  );
}
