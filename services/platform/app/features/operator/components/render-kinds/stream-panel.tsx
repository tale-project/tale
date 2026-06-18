'use client';

/** `stream` — a chronological feed (the agent-run spine). `params.entryKind`
 * (message | tool_call | log) hints the dominant entry type; folds transcript /
 * tool-call-card / event-log into one kind. */
import { Badge } from '@tale/ui/badge';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import {
  asRecord,
  pickArray,
  pickString,
  scalar,
} from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { OutputFallback } from '../output-fallback';

export function StreamPanel({ step }: { step: StepProjection }) {
  const out = asRecord(step.output);
  const entries = pickArray(out, 'entries', 'transcript', 'events', 'messages');

  // The agent-run handoff summary, when present, is the headline of the feed.
  const summary = pickString(out, 'summary');

  if (entries.length === 0 && summary === undefined) {
    return <OutputFallback step={step} />;
  }

  return (
    <VStack gap={2}>
      {summary !== undefined && (
        <Text as="div" className="whitespace-pre-wrap">
          {summary}
        </Text>
      )}
      {entries.slice(0, 100).map((raw, i) => {
        const entry = asRecord(raw);
        const kind =
          pickString(entry, 'type', 'kind', 'role') ??
          step.params?.entryKind ??
          'log';
        const text =
          pickString(entry, 'text', 'content', 'message', 'name') ??
          scalar(raw);
        return (
          <HStack key={i} gap={2} className="items-start">
            <Badge variant="slate">{kind}</Badge>
            <Text as="span" className="min-w-0 whitespace-pre-wrap">
              {text}
            </Text>
          </HStack>
        );
      })}
    </VStack>
  );
}
