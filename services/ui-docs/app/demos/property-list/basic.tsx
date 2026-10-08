import { Badge } from '@tale/ui/badge';
import { DatePicker } from '@tale/ui/date-picker';
import {
  PropertyDivider,
  PropertyList,
  PropertyRow,
} from '@tale/ui/property-list';
import { useState } from 'react';

/** Tuesday, September 29, 2026, local midnight. */
const DUE = new Date(2026, 8, 29).getTime();

export default function PropertyListBasic() {
  const [due, setDue] = useState<number | undefined>(DUE);

  return (
    <PropertyList as="aside" className="w-full max-w-[17rem] text-sm">
      <PropertyRow label="Status">
        <Badge variant="blue" dot>
          In progress
        </Badge>
      </PropertyRow>
      <PropertyRow label="Assignee">Ada Lovelace</PropertyRow>
      <PropertyRow label="Due date">
        <DatePicker
          variant="ghost"
          value={due}
          onChange={(next) => setDue(next ?? undefined)}
        />
      </PropertyRow>
      <PropertyDivider />
      <PropertyRow label="Labels" stacked>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">Design</Badge>
          <Badge variant="outline">Web</Badge>
        </div>
      </PropertyRow>
    </PropertyList>
  );
}
