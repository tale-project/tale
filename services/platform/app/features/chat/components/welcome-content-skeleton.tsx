import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { useT } from '@/lib/i18n/client';

export function WelcomeContentSkeleton() {
  const { t } = useT('chat');
  return (
    <div className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center">
      <Skeleton className="h-9 w-80" label={t('skeleton.loadingWelcome')} />
      <div className="divide-border flex flex-col divide-y">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="py-4">
            <Skeleton
              className="h-4 w-64"
              label={t('skeleton.loadingSuggestion')}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
