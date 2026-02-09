import React from 'react';

interface AutomationGroupNodeProps {
  data: {
    label: string;
  };
}

export function AutomationGroupNode({ data }: AutomationGroupNodeProps) {
  return (
    <div className="flex h-full w-full items-start justify-start p-2">
      <span className="text-muted-foreground/60 text-xs font-medium">
        {data.label}
      </span>
    </div>
  );
}
