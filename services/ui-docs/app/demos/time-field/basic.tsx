import { TimeField } from '@tale/ui/time-field';
import type { TimeOfDay } from '@tale/ui/time-of-day';
import { useState } from 'react';

/** "17:30", whatever clock the field shows. */
function asText(time: TimeOfDay): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export default function TimeFieldBasic() {
  const [opens, setOpens] = useState<TimeOfDay>({ hour: 8, minute: 30 });
  const [closes, setCloses] = useState<TimeOfDay>({ hour: 17, minute: 30 });

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <TimeField
        label="Opens at (24-hour clock)"
        hourCycle={24}
        value={opens}
        onValueChange={setOpens}
      />
      <TimeField
        label="Closes at (12-hour clock)"
        hourCycle={12}
        value={closes}
        onValueChange={setCloses}
      />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Stored as {asText(opens)} to {asText(closes)}.
      </p>
    </div>
  );
}
