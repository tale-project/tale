import { Skeleton } from '@tale/ui/skeleton';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const rows: Array<{ role: 'user' | 'assistant'; widths: string[] }> = [
  { role: 'user', widths: ['w-40'] },
  { role: 'assistant', widths: ['w-full', 'w-5/6', 'w-2/3'] },
  { role: 'user', widths: ['w-56'] },
  { role: 'assistant', widths: ['w-full', 'w-4/5'] },
];

export function MessagesSkeleton() {
  const { t } = useT('chat');
  return (
    // `mx-auto` + `pt-6` mirror the real message list wrapper
    // (chat-messages.tsx) so the first row sits where real content starts and
    // the skeleton→messages swap doesn't shift the viewport vertically.
    <div className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-6 pt-6">
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
              label={t('skeleton.loadingMessage')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
