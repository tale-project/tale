import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface FilterSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  active?: boolean;
}

export function FilterSection({
  title,
  isExpanded,
  onToggle,
  children,
  active = false,
}: FilterSectionProps) {
  return (
    <div className="space-y-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full p-2 text-left hover:bg-muted rounded-md relative"
      >
        <ChevronRight
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-90',
          )}
        />
        <span className="text-sm font-medium text-foreground">{title}</span>
        {active && <div className="h-2 w-2 bg-blue-500 rounded-full ml-auto" />}
      </button>
      {isExpanded && <div className="space-y-2 px-2">{children}</div>}
    </div>
  );
}
