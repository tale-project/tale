import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { cn } from '@/lib/utils/cn';

/**
 * Masked stand-in for an open conversation while its messages are on their
 * way — message-shaped, in place, per the design system's "skeletons mask in
 * place, never a bare spinner where a skeleton fits". Mirrors MessageThread's
 * geometry (centered `max-w-3xl` column, role label over body lines, list
 * gap) so the loaded conversation is a mask swap, not a re-layout. Two
 * exchanges only: enough to read as "a conversation is coming" without
 * pretending to know its length.
 */
export function ConversationSkeleton({
  label,
  className,
}: {
  /** Announced once for the region (`Skeletonize`'s status label). */
  label: string;
  className?: string;
}) {
  return (
    <Skeletonize
      loading
      label={label}
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
    >
      <Stack gap={5} className="mx-auto w-full max-w-3xl px-4 py-6">
        <Exchange roleWidth="w-8" lineWidths={['46%']} />
        <Exchange roleWidth="w-16" lineWidths={['92%', '86%', '58%']} />
        <Exchange roleWidth="w-8" lineWidths={['34%']} />
      </Stack>
    </Skeletonize>
  );
}

/** One masked message: the uppercase role label line, then its body lines. */
function Exchange({
  roleWidth,
  lineWidths,
}: {
  roleWidth: string;
  lineWidths: readonly string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SkeletonBox>
        <div className={cn('h-3', roleWidth)} />
      </SkeletonBox>
      {lineWidths.map((width, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} style={{ width }}>
          <SkeletonBox fullWidth>
            <div className="h-3.5" />
          </SkeletonBox>
        </div>
      ))}
    </div>
  );
}
