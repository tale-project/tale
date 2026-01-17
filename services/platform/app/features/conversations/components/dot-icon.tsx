import { cn } from '@/lib/utils/cn';

interface DotIconProps {
  className?: string;
}

export function DotIcon({ className }: DotIconProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center size-4',
        className,
      )}
    >
      <div className="size-[0.1875rem] rounded-full bg-muted-foreground" />
    </div>
  );
}
