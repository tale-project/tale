import React from 'react';

interface AutomationGroupNodeProps {
  data: {
    label: string;
  };
}

export function AutomationGroupNode({
  data,
}: AutomationGroupNodeProps) {
  return (
    <div className="w-full h-full flex items-start justify-start p-2">
      <span className="text-xs text-muted-foreground/60 font-medium">
        {data.label}
      </span>
    </div>
  );
}
