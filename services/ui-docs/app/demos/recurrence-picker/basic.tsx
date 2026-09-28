import type { RecurrenceRule } from '@tale/ui/recurrence';
import { RecurrencePicker } from '@tale/ui/recurrence-picker';
import { useState } from 'react';

/** The task's due date, Tuesday, September 29, 2026, with its weekday. */
const DUE = { year: 2026, month: 9, day: 29, weekday: 2 };

export default function RecurrencePickerBasic() {
  const [rule, setRule] = useState<RecurrenceRule | null>(null);

  return (
    <dl className="grid w-full max-w-xs grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Due date</dt>
      <dd className="px-1.5">Tue, Sep 29, 2026</dd>
      <dt className="text-muted-foreground">Repeat</dt>
      <dd className="min-w-0">
        <RecurrencePicker value={rule} reference={DUE} onChange={setRule} />
      </dd>
    </dl>
  );
}
