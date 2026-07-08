import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import React from 'react';

interface WorkflowGroupNodeProps {
  data: {
    label: string;
  };
}

export function WorkflowGroupNode({ data }: WorkflowGroupNodeProps) {
  return (
    <Row gap={0} align="start" className="h-full w-full p-2">
      <Text
        as="span"
        variant="caption"
        className="text-muted-foreground/60 font-medium"
      >
        {data.label}
      </Text>
    </Row>
  );
}
