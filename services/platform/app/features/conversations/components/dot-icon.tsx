import { cn } from '@/lib/utils/cn';

interface DotIconProps {
  className?: string;
}

/**
 * The dot between two pieces of conversation metadata.
 *
 * Centred by position, not by flex: `cn` merges display utilities as ONE
 * group, so a caller that reveals the separator responsively
 * (`hidden md:inline-flex`) replaces this element's own display value — and a
 * flex item's `inline` blockifies to `block` besides. Under anything but a
 * flex box `items-center` stops applying, which used to leave the dot riding
 * at the top of its 1rem box instead of on the text's midline.
 */
export function DotIcon({ className }: DotIconProps) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0', className)}>
      <span className="bg-muted-foreground absolute top-1/2 left-1/2 size-[0.1875rem] -translate-x-1/2 -translate-y-1/2 rounded-full" />
    </span>
  );
}
