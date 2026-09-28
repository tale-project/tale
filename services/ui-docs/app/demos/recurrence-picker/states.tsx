import { RecurrencePicker } from '@tale/ui/recurrence-picker';

/** The task's due date, Tuesday, September 29, 2026, with its weekday. */
const DUE = { year: 2026, month: 9, day: 29, weekday: 2 };

export default function RecurrencePickerStates() {
  return (
    <dl className="grid w-full max-w-sm grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Closed task</dt>
      <dd className="min-w-0">
        <RecurrencePicker
          value={{ frequency: 'monthly', interval: 1, monthDay: 30 }}
          reference={DUE}
          description="The next task is created when this one is done."
          disabled
          disabledReason="Reopen this task to change how it repeats."
          onChange={() => {}}
        />
      </dd>
      <dt className="text-muted-foreground">Viewer</dt>
      <dd className="min-w-0">
        <RecurrencePicker
          value={{ frequency: 'weekly', interval: 1, weekdays: [2, 4] }}
          reference={DUE}
          readOnly
          onChange={() => {}}
        />
      </dd>
      <dt className="text-muted-foreground">Narrow column</dt>
      <dd className="w-32">
        <RecurrencePicker
          value={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
          reference={DUE}
          onChange={() => {}}
        />
      </dd>
    </dl>
  );
}
