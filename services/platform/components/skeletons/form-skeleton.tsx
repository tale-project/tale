import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/cn';

interface FormFieldSkeletonProps {
  /** Whether this is a textarea (taller) */
  isTextarea?: boolean;
  /** Additional class name */
  className?: string;
}

function FormFieldSkeleton({
  isTextarea = false,
  className,
}: FormFieldSkeletonProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Label */}
      <Skeleton className="h-4 w-24" />
      {/* Input */}
      <Skeleton className={cn('w-full rounded-md', isTextarea ? 'h-24' : 'h-10')} />
    </div>
  );
}

interface FormSkeletonProps {
  /** Number of text fields */
  fields?: number;
  /** Whether to include a textarea */
  hasTextarea?: boolean;
  /** Whether to show form actions (submit button) */
  showActions?: boolean;
  /** Layout of the form */
  layout?: 'single' | 'two-column';
  /** Additional class name */
  className?: string;
}

/**
 * Form skeleton for loading states.
 *
 * ## Example:
 * ```tsx
 * <FormSkeleton fields={4} hasTextarea showActions layout="two-column" />
 * ```
 */
export function FormSkeleton({
  fields = 3,
  hasTextarea = false,
  showActions = true,
  layout = 'single',
  className,
}: FormSkeletonProps) {
  return (
    <div className={cn('space-y-6', className)}>
      <div
        className={cn(
          'space-y-4',
          layout === 'two-column' && 'grid grid-cols-1 sm:grid-cols-2 gap-4 space-y-0'
        )}
      >
        {Array.from({ length: fields }).map((_, i) => (
          <FormFieldSkeleton key={i} />
        ))}
        {hasTextarea && <FormFieldSkeleton isTextarea className="sm:col-span-2" />}
      </div>

      {showActions && (
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      )}
    </div>
  );
}

