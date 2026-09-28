import type { RecurrenceRule } from '@tale/ui/recurrence';
import { RecurrencePicker } from '@tale/ui/recurrence-picker';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { useState } from 'react';

/** The task's due date, Tuesday, September 29, 2026, with its weekday. */
const DUE = { year: 2026, month: 9, day: 29, weekday: 2 };

export default function RecurrencePickerCustom() {
  const format = useRecurrenceFormat();
  const [rule, setRule] = useState<RecurrenceRule | null>({
    frequency: 'weekly',
    interval: 2,
    weekdays: [2, 4],
  });
  const [saves, setSaves] = useState(0);

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <RecurrencePicker
        value={rule}
        reference={DUE}
        onChange={(next) => {
          setRule(next);
          setSaves((count) => count + 1);
        }}
      />
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {saves === 0
          ? 'Nothing saved yet.'
          : `Save ${saves}: ${rule ? format.sentence(rule) : format.never}`}
      </p>
    </div>
  );
}
