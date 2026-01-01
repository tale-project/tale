import { Skeleton } from '@/components/ui/skeleton';
import { Stack, HStack, Grid } from '@/components/ui/layout';
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
    <Stack gap={2} className={className}>
      {/* Label */}
      <Skeleton className="h-4 w-24" />
      {/* Input */}
      <Skeleton className={cn('w-full rounded-md', isTextarea ? 'h-24' : 'h-9')} />
    </Stack>
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
    <Stack gap={6} className={className}>
      {layout === 'two-column' ? (
        <Grid cols={1} sm={2} gap={4}>
          {Array.from({ length: fields }).map((_, i) => (
            <FormFieldSkeleton key={i} />
          ))}
          {hasTextarea && <FormFieldSkeleton isTextarea className="sm:col-span-2" />}
        </Grid>
      ) : (
        <Stack gap={4}>
          {Array.from({ length: fields }).map((_, i) => (
            <FormFieldSkeleton key={i} />
          ))}
          {hasTextarea && <FormFieldSkeleton isTextarea />}
        </Stack>
      )}

      {showActions && (
        <HStack gap={2} justify="end" className="pt-4 border-t">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </HStack>
      )}
    </Stack>
  );
}

