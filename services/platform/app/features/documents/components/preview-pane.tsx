import { cn } from '@/lib/utils/cn';

interface PreviewPaneProps {
  children: React.ReactNode;
  className?: string;
}

export function PreviewPane({ children, className }: PreviewPaneProps) {
  return (
    <div
      className={cn(
        'relative mx-auto w-full flex flex-1 flex-col overflow-x-auto overflow-y-auto p-6 bg-muted rounded-lg min-h-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
