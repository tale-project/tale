import { Skeleton } from '@tale/ui/skeleton';

import { useT } from '@/lib/i18n/client';

export function WelcomeContentSkeleton() {
  const { t } = useT('chat');
  return (
    <div
      aria-busy="true"
      className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center"
    >
      {/* Mirrors WelcomeView's `Heading text-[1.75rem]` line height. */}
      <Skeleton className="h-9 w-80" label={t('skeleton.loadingWelcome')} />
      <div className="divide-border flex flex-col divide-y">
        {/* Each row mirrors WelcomeView's `li.py-1 > button.py-3.text-sm`
            structure so the skeleton→content swap doesn't shift layout. */}
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="py-1">
            <div className="py-3">
              <Skeleton
                className="h-5 w-64"
                label={t('skeleton.loadingSuggestion')}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
