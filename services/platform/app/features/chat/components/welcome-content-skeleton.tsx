import { Skeleton } from '@/app/components/ui/feedback/skeleton';

export function WelcomeContentSkeleton() {
  return (
    <div className="flex w-full max-w-(--chat-max-width) flex-col gap-6 self-center">
      <Skeleton className="h-9 w-80" label="Loading welcome" />
      <div className="divide-border flex flex-col divide-y">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="py-4">
            <Skeleton className="h-4 w-64" label="Loading suggestion" />
          </div>
        ))}
      </div>
    </div>
  );
}
