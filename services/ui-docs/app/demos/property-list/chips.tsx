import { PropertyChip } from '@tale/ui/property-chip';
import { CalendarDays, Circle, SignalHigh, User } from 'lucide-react';
import { useState } from 'react';

export default function PropertyListChips() {
  const [due, setDue] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <PropertyChip icon={<Circle />} aria-label="To do status">
        To do
      </PropertyChip>
      <PropertyChip icon={<SignalHigh />} aria-label="Medium priority">
        Medium
      </PropertyChip>
      <PropertyChip icon={<User />} aria-label="Ada Lovelace assignee">
        Ada Lovelace
      </PropertyChip>
      <PropertyChip icon={<CalendarDays />} aria-label="Starts today">
        Today
      </PropertyChip>
      <PropertyChip
        empty={!due}
        icon={<CalendarDays />}
        onClick={() => setDue((value) => !value)}
        aria-label={due ? 'Due Oct 12' : undefined}
      >
        {due ? 'Oct 12' : 'Due date'}
      </PropertyChip>
    </div>
  );
}
