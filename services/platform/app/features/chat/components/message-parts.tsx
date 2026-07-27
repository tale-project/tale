'use client';

/**
 * One message's content, rendered as the ordered list of parts it was
 * authored as.
 *
 * The order is the record: a tool call, its result, an approval card and an
 * attachment are all things the model saw, in the sequence it saw them, so
 * they render in that sequence rather than being regrouped by kind. Every
 * part kind in `MessagePart` has a branch here; an unknown kind renders
 * nothing rather than leaking a raw object onto the screen.
 */

import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Paperclip, ShieldQuestion, UserRoundPen, Wrench } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';

import type { MessagePart } from '../types';

/** Row chrome shared by every non-text part: an icon, a label, and detail. */
function PartRow({
  icon: Icon,
  label,
  detail,
  trailing,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-1.5">
      <Icon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-foreground min-w-0 truncate text-sm">{label}</span>
      {detail && (
        <Text variant="muted" className="min-w-0 truncate text-xs">
          {detail}
        </Text>
      )}
      {trailing && <div className="ml-auto shrink-0">{trailing}</div>}
    </div>
  );
}

export function MessageParts({
  parts,
  markdown = false,
}: {
  parts: readonly MessagePart[];
  /** Render text parts as markdown (assistant answers) instead of the plain
   * pre-wrapped text a user's own words keep. */
  markdown?: boolean;
}) {
  const { t } = useT('chat');

  return (
    <Stack gap={2} className="min-w-0">
      {parts.map((part, index) => {
        switch (part.type) {
          case 'text':
            return markdown ? (
              <MarkdownContent key={index} content={part.text} />
            ) : (
              <p
                key={index}
                className="text-foreground text-sm leading-relaxed whitespace-pre-wrap"
              >
                {part.text}
              </p>
            );
          case 'attachment':
            return (
              <PartRow
                key={index}
                icon={Paperclip}
                label={t('parts.attachment', { name: part.name })}
                detail={part.mediaType}
              />
            );
          case 'tool-call':
            return (
              <PartRow
                key={index}
                icon={Wrench}
                label={t('parts.toolCall', { tool: part.capabilityId })}
              />
            );
          case 'tool-result':
            return (
              <PartRow
                key={index}
                icon={Wrench}
                label={t('parts.toolResult', { tool: part.capabilityId })}
              />
            );
          case 'approval':
            return (
              <PartRow
                key={index}
                icon={ShieldQuestion}
                label={part.question}
                trailing={
                  <Badge variant="outline">
                    {part.decision === 'approved'
                      ? t('parts.approvalApproved')
                      : part.decision === 'rejected'
                        ? t('parts.approvalRejected')
                        : t('parts.approvalPending')}
                  </Badge>
                }
              />
            );
          case 'human-input':
            return (
              <PartRow
                key={index}
                icon={UserRoundPen}
                label={part.question}
                detail={part.answer}
                trailing={
                  <Badge variant="outline">
                    {part.answer
                      ? t('parts.humanInputAnswered')
                      : t('parts.humanInputPending')}
                  </Badge>
                }
              />
            );
          default:
            return null;
        }
      })}
    </Stack>
  );
}
