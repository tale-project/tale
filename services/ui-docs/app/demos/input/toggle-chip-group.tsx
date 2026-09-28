import { ToggleChipGroup } from '@tale/ui/toggle-chip-group';
import { useState } from 'react';

const DAYS = [
  { value: 'mon', label: 'Mo', 'aria-label': 'Monday' },
  { value: 'tue', label: 'Tu', 'aria-label': 'Tuesday' },
  { value: 'wed', label: 'We', 'aria-label': 'Wednesday' },
  { value: 'thu', label: 'Th', 'aria-label': 'Thursday' },
  { value: 'fri', label: 'Fr', 'aria-label': 'Friday' },
  { value: 'sat', label: 'Sa', 'aria-label': 'Saturday' },
  { value: 'sun', label: 'Su', 'aria-label': 'Sunday' },
];

export default function InputToggleChipGroup() {
  const [days, setDays] = useState(['tue', 'thu']);

  return (
    <div className="flex flex-col gap-1.5">
      <span
        id="office-days"
        className="text-muted-foreground text-xs font-medium"
      >
        Office days
      </span>
      <ToggleChipGroup
        aria-labelledby="office-days"
        value={days}
        onValueChange={setDays}
        options={DAYS}
        minSelected={1}
      />
    </div>
  );
}
