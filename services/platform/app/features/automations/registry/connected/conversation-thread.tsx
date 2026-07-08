'use client';

/**
 * Connected `ConversationThread` block — the detail half of an inbox
 * master-detail split. Binds a single reactive read (typically
 * `getConversationWithMessages` with `conversationId: '$state.<key>'`) and
 * renders the message list with the promoted bubble anatomy, grouped by date
 * (the shared `groupMessagesByDate` util). Everything domain-shaped comes
 * from the `message` field map: author, body (`bodyFormat: text|markdown|html`),
 * timestamp, direction, and — additive beyond the published schema —
 * `deliveryStateField` for the outbound queued/failed indicator.
 *
 * Header `actions` are per-status verbs (BoundButtons whose `when`
 * predicates evaluate against the loaded conversation record); an optional
 * `attachmentAction` renders on every attachment card, dispatched with the
 * attachment (+ its `messageId`) as `$selected`. While the `$state.` binding
 * is unset the block shows the awaiting-selection placeholder
 * (`placeholderKey` overrides the default copy).
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { Row, Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { argsReferenceViewState } from '@/lib/shared/platform/function_bindings';
import type { BoundActionSpec } from '@/lib/shared/schemas/automation_views';
import { isRecord, primitiveString } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { BindingStates, BlockFrame } from '../block-frame';
import { BoundButton } from './bound-button';
import { groupByTimestamp } from './conversation-parts/date-groups';
import {
  type BubbleAttachment,
  ConversationMessageBubble,
  isOutboundDirection,
} from './conversation-parts/message-bubble';

export interface ConversationThreadProps {
  /** Messages query — typically bound to `$state.conversationId`. */
  query: { path: string; args?: unknown };
  /** Field map from a message row to the bubble anatomy. */
  message: {
    authorField: string;
    bodyField: string;
    timestampField?: string;
    /** Row field distinguishing inbound/outbound bubbles — an
     *  `'inbound'`/`'outbound'` string or an "is inbound/customer" boolean. */
    directionField?: string;
    bodyFormat?: 'text' | 'markdown' | 'html';
    /** Row field carrying the delivery state (`queued`/`failed` indicator on
     *  outbound bubbles). Additive beyond the published prop schema. */
    deliveryStateField?: string;
  };
  placeholderKey?: string;
  /** Per-status header verbs — `when` evaluates against the conversation. */
  actions?: BoundActionSpec[];
  /** Bound action for downloading/opening a message attachment. */
  attachmentAction?: BoundActionSpec;
}

interface NormalizedMessage {
  key: string;
  author?: string;
  body: string;
  timestamp: string;
  outbound: boolean;
  deliveryState?: string;
  attachments: Record<string, unknown>[];
}

/** The messages array: the record's `messages` field, or a bare array. */
export function pickMessages(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.messages)) {
    return data.messages.filter(isRecord);
  }
  return [];
}

/** Attachments ride on the row (`attachments`) or under `metadata`. */
function pickAttachments(
  row: Record<string, unknown>,
): Record<string, unknown>[] {
  if (Array.isArray(row.attachments)) return row.attachments.filter(isRecord);
  if (isRecord(row.metadata) && Array.isArray(row.metadata.attachments)) {
    return row.metadata.attachments.filter(isRecord);
  }
  return [];
}

function normalizeMessage(
  row: Record<string, unknown>,
  index: number,
  map: ConversationThreadProps['message'],
): NormalizedMessage {
  const stringOf = primitiveString;
  const rawTimestamp = map.timestampField ? row[map.timestampField] : undefined;
  return {
    key: stringOf(row.id ?? row._id) ?? String(index),
    author: stringOf(row[map.authorField]),
    body: stringOf(row[map.bodyField]) ?? '',
    timestamp:
      typeof rawTimestamp === 'number'
        ? new Date(rawTimestamp).toISOString()
        : (stringOf(rawTimestamp) ?? ''),
    outbound: map.directionField
      ? isOutboundDirection(row[map.directionField])
      : false,
    deliveryState: map.deliveryStateField
      ? stringOf(row[map.deliveryStateField])
      : undefined,
    attachments: pickAttachments(row),
  };
}

export function ConversationThread({
  query,
  message,
  placeholderKey,
  actions,
  attachmentAction,
}: ConversationThreadProps) {
  const { t } = useT('automations');
  const { formatDate, formatDateHeader } = useFormatDate();

  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    query.path,
    query.args,
  );

  const awaiting = needsConfig && argsReferenceViewState(query.args);
  const conversation = isRecord(data) ? data : undefined;
  const rows = pickMessages(data);
  const normalized = rows.map((row, index) =>
    normalizeMessage(row, index, message),
  );
  // Group by date only when a timestamp field is mapped; otherwise render one
  // flat, headerless group.
  const groups = message.timestampField
    ? groupByTimestamp(normalized.filter((m) => m.timestamp !== ''))
    : [{ date: '', items: normalized }];

  const headerActions =
    conversation && (actions?.length ?? 0) > 0 ? (
      <Row gap={2} wrap className="justify-end">
        {(actions ?? []).map((action, index) => (
          <BoundButton
            key={`${action.path}-${index}`}
            action={action}
            item={conversation}
          />
        ))}
      </Row>
    ) : undefined;

  const toBubbleAttachments = (
    normalizedMessage: NormalizedMessage,
  ): BubbleAttachment[] =>
    normalizedMessage.attachments.map((attachment, index) => {
      const filename =
        typeof attachment.filename === 'string' ? attachment.filename : '';
      return {
        key:
          typeof attachment.id === 'string'
            ? attachment.id
            : `${normalizedMessage.key}-${index}`,
        filename,
        size: typeof attachment.size === 'number' ? attachment.size : undefined,
        action: attachmentAction ? (
          <BoundButton
            action={attachmentAction}
            item={{ ...attachment, messageId: normalizedMessage.key }}
          />
        ) : undefined,
      };
    });

  return (
    <BlockFrame actions={headerActions}>
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig && !awaiting}
        awaitingState={awaiting && placeholderKey === undefined}
        loading={isLoading}
      >
        {awaiting && placeholderKey !== undefined ? (
          // The awaiting-selection flavor with the view's own copy — same
          // muted-text treatment as `BindingStates.awaitingState`.
          <Text variant="muted">{placeholderKey}</Text>
        ) : normalized.length === 0 ? (
          <Text variant="muted">{t('binding.empty')}</Text>
        ) : (
          <VStack gap={2}>
            {groups.map((group) => (
              <div key={group.date || 'all'}>
                {group.date !== '' && (
                  <div className="mb-4 py-2">
                    <Row gap={0} align="stretch" justify="center">
                      <div className="bg-background border-border rounded-full border px-2 py-0.5 shadow-sm">
                        <Text
                          as="span"
                          variant="label-sm"
                          className="text-primary"
                        >
                          {formatDateHeader(group.date)}
                        </Text>
                      </div>
                    </Row>
                  </div>
                )}
                <Stack gap={4} className="mb-4">
                  {group.items.map((normalizedMessage) => (
                    <ConversationMessageBubble
                      key={normalizedMessage.key}
                      author={normalizedMessage.author}
                      body={normalizedMessage.body}
                      bodyFormat={message.bodyFormat ?? 'text'}
                      timestampLabel={
                        normalizedMessage.timestamp !== ''
                          ? formatDate(normalizedMessage.timestamp, 'time')
                          : undefined
                      }
                      outbound={normalizedMessage.outbound}
                      deliveryState={normalizedMessage.deliveryState}
                      attachments={toBubbleAttachments(normalizedMessage)}
                    />
                  ))}
                </Stack>
              </div>
            ))}
          </VStack>
        )}
      </BindingStates>
    </BlockFrame>
  );
}

type ConversationThreadBlockProps = Partial<ConversationThreadProps>;

/**
 * The registry entry for `registerConnectedBlock('ConversationThread', …)` —
 * wired into `registry/tale-config.tsx` by the registration site.
 */
export const conversationThreadBlock: {
  fields: Fields;
  render: PuckComponent<ConversationThreadBlockProps>;
} = {
  fields: { placeholderKey: { type: 'text' } },
  render: ({ query, message, placeholderKey, actions, attachmentAction }) =>
    query && message ? (
      <ConversationThread
        query={query}
        message={message}
        placeholderKey={placeholderKey}
        actions={actions}
        attachmentAction={attachmentAction}
      />
    ) : (
      <></>
    ),
};
