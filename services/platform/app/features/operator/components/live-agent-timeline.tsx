'use client';

/**
 * The live transcript of a workflow sandbox agent — the rich tool/reasoning/text
 * timeline, reused wholesale from the chat path. A workflow run has no chat
 * message, so its agent activity is persisted as bounded UI parts on the
 * workflow-run op (`liveTimeline`); this renders those parts with the SAME
 * segment builder + thought-timeline rows the chat bubble uses (the
 * `NestedDelegationTimeline` precedent), so the operator watches what the agent
 * DOES — Bash/Edit/test cards, folded sub-agents, prose — not a flat text blob.
 */
import { Badge } from '@tale/ui/badge';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { memo, useMemo } from 'react';

import {
  InlineReasoning,
  ThinkingDots,
  ToolStepRow,
} from '@/app/features/chat/components/thought-timeline';
import { buildMessageSegments } from '@/app/features/chat/utils/build-message-segments';
import { useT } from '@/lib/i18n/client';

function LiveAgentTimelineImpl({
  parts,
  active,
}: {
  /** The op's `liveTimeline` UI parts (text / `tool-<name>` / reasoning). */
  parts: readonly unknown[] | undefined;
  /** Whether the step is still running (gates the live spinner + Live badge). */
  active: boolean;
}) {
  const { t } = useT('operator');
  const { segments } = useMemo(() => buildMessageSegments(parts), [parts]);

  if (segments.length === 0) {
    return active ? <ThinkingDots /> : null;
  }

  return (
    <VStack gap={2}>
      {active && (
        <HStack gap={2} className="items-center">
          <Badge variant="blue" dot>
            {t('state.live', { defaultValue: 'Live' })}
          </Badge>
          <ThinkingDots />
        </HStack>
      )}
      {segments.map((segment) => {
        if (segment.kind === 'text') {
          return segment.text.trim() === '' ? null : (
            <Text key={segment.id} as="div" className="whitespace-pre-wrap">
              {segment.text}
            </Text>
          );
        }
        if (segment.kind === 'reasoning') {
          return (
            <InlineReasoning key={segment.id} step={segment} active={active} />
          );
        }
        return (
          <div key={segment.id} className="my-1">
            <ToolStepRow step={segment} active={active} />
          </div>
        );
      })}
    </VStack>
  );
}

export const LiveAgentTimeline = memo(LiveAgentTimelineImpl);
