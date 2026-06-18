'use client';

/** A compact label→value metric grid shared by the read-only panels. */
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

export interface KvRow {
  label: string;
  value: string;
}

export function KvGrid({ rows }: { rows: KvRow[] }) {
  if (rows.length === 0) return null;
  return (
    <VStack gap={1}>
      {rows.map((row) => (
        <HStack key={row.label} gap={2} className="justify-between">
          <Text as="span" variant="muted">
            {row.label}
          </Text>
          <Text as="span" className="font-medium">
            {row.value}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}
