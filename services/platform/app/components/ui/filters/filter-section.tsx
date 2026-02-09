import { ChevronRight } from 'lucide-react';

import { Stack, HStack } from '@/app/components/ui/layout/layout';
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
    <Stack gap={1}>
      <button
        onClick={onToggle}
        className="hover:bg-muted relative w-full rounded-md p-2 text-left"
      >
        <HStack gap={2}>
          <ChevronRight
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          />
          <span className="text-foreground text-sm font-medium">{title}</span>
          {active && (
            <div className="ml-auto h-2 w-2 rounded-full bg-blue-500" />
          )}
        </HStack>
      </button>
      {isExpanded && (
        <Stack gap={2} className="px-2">
          {children}
        </Stack>
      )}
    </Stack>
  );
}
