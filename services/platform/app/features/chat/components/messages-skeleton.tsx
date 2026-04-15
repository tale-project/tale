import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { cn } from '@/lib/utils/cn';

const rows: Array<{ role: 'user' | 'assistant'; widths: string[] }> = [
  { role: 'user', widths: ['w-40'] },
  { role: 'assistant', widths: ['w-full', 'w-5/6', 'w-2/3'] },
  { role: 'user', widths: ['w-56'] },
  { role: 'assistant', widths: ['w-full', 'w-4/5'] },
];

export function MessagesSkeleton() {
  return (
    <div className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center">
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className={cn(
            'flex flex-col gap-2',
            row.role === 'user' ? 'items-end' : 'items-start',
          )}
        >
          {row.widths.map((w, i) => (
            <Skeleton
              key={i}
              className={cn('h-4', w)}
              label="Loading message"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
