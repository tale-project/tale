import React from 'react';

import { Text } from '@/app/components/ui/typography/text';

interface AutomationGroupNodeProps {
  data: {
    label: string;
  };
}

export function AutomationGroupNode({ data }: AutomationGroupNodeProps) {
  return (
    <div className="flex h-full w-full items-start justify-start p-2">
      <Text
        as="span"
        variant="caption"
        className="text-muted-foreground/60 font-medium"
      >
        {data.label}
      </Text>
    </div>
  );
}
