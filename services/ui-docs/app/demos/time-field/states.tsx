import { TimeField } from '@tale/ui/time-field';
import type { TimeOfDay } from '@tale/ui/time-of-day';
import { useState } from 'react';

export default function TimeFieldStates() {
  const [reminder, setReminder] = useState<TimeOfDay>({ hour: 7, minute: 0 });
  const [quietHours, setQuietHours] = useState<TimeOfDay>({
    hour: 22,
    minute: 0,
  });
  const tooEarly = reminder.hour < 8;

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <TimeField
        label="Send the reminder at"
        description="Office hours start at 8:00."
        errorMessage={tooEarly ? 'Pick 8:00 or later.' : undefined}
        value={reminder}
        onValueChange={setReminder}
      />
      <TimeField
        label="Backup window (locked)"
        disabled
        value={{ hour: 2, minute: 0 }}
        onValueChange={() => {}}
      />
      <TimeField
        label="Created at"
        readOnly
        value={{ hour: 14, minute: 45 }}
        onValueChange={() => {}}
      />
      <TimeField
        label="Quiet hours start (compact)"
        size="sm"
        value={quietHours}
        onValueChange={setQuietHours}
      />
    </div>
  );
}
