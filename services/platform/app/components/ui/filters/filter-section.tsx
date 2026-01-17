import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Stack, HStack } from '@/app/components/ui/layout/layout';

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
    <Stack gap={1}>
      <button
        onClick={onToggle}
        className="w-full p-2 text-left hover:bg-muted rounded-md relative"
      >
        <HStack gap={2}>
          <ChevronRight
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {active && <div className="h-2 w-2 bg-blue-500 rounded-full ml-auto" />}
        </HStack>
      </button>
      {isExpanded && <Stack gap={2} className="px-2">{children}</Stack>}
    </Stack>
  );
}
