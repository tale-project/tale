import { Duration, useFormatDuration } from '@tale/ui/format-duration';
import { useState } from 'react';

const SPANS = [320, 3_240, 42_000, 192_000, 7_500_000, 97_200_000];

export default function FormatDurationBasic() {
  const format = useFormatDuration();
  const [since] = useState(() => Date.now() - 12_000);
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-1 font-medium">Milliseconds</th>
            <th className="py-1 font-medium">short</th>
            <th className="py-1 font-medium">narrow</th>
            <th className="py-1 font-medium">long, one unit</th>
          </tr>
        </thead>
        <tbody>
          {SPANS.map((ms) => (
            <tr key={ms} className="border-border border-t">
              <td className="py-1 font-mono text-xs">{ms}</td>
              <td className="py-1">
                <Duration ms={ms} />
              </td>
              <td className="py-1">
                <Duration ms={ms} unitDisplay="narrow" />
              </td>
              <td className="py-1">
                {format(ms, { style: 'long', maxUnits: 1 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm">
        Running for <Duration since={since} live />
      </p>
    </div>
  );
}
