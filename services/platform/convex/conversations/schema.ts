import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const conversationsTable = defineTable({
  organizationId: v.string(),
  customerId: v.optional(v.id('customers')),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(
    v.union(
      v.literal('open'),
      v.literal('closed'),
      v.literal('spam'),
      v.literal('archived'),
    ),
  ),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_priority', ['organizationId', 'priority'])
  .index('by_organizationId_and_customerId', ['organizationId', 'customerId'])
  .index('by_organizationId_and_direction', ['organizationId', 'direction'])
  .index('by_organizationId_and_channel', ['organizationId', 'channel'])
  .index('by_organizationId_and_type', ['organizationId', 'type'])
  .index('by_organizationId_and_externalMessageId', [
    'organizationId',
    'externalMessageId',
  ])
  .index('by_org_status_lastMessageAt', [
    'organizationId',
    'status',
    'lastMessageAt',
  ]);

export const conversationMessagesTable = defineTable({
  organizationId: v.string(),
  conversationId: v.id('conversations'),
  channel: v.string(),
  direction: v.union(v.literal('inbound'), v.literal('outbound')),
  externalMessageId: v.optional(v.string()),
  deliveryState: v.union(
    v.literal('queued'),
    v.literal('sent'),
    v.literal('delivered'),
    v.literal('failed'),
  ),
  retryCount: v.optional(v.number()),
  content: v.string(),
  sentAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_conversationId_and_deliveredAt', ['conversationId', 'deliveredAt'])
  .index('by_organizationId_and_deliveredAt', ['organizationId', 'deliveredAt'])
  .index('by_organizationId_and_direction', ['organizationId', 'direction'])
  .index('by_organizationId_and_externalMessageId', [
    'organizationId',
    'externalMessageId',
  ])
  .index('by_org_channel_direction_deliveredAt', [
    'organizationId',
    'channel',
    'direction',
    'deliveredAt',
  ])
  .index('by_org_deliveryState_deliveredAt', [
    'organizationId',
    'deliveryState',
    'deliveredAt',
  ])
  .index('by_org_channel_direction_deliveryState_deliveredAt', [
    'organizationId',
    'channel',
    'direction',
    'deliveryState',
    'deliveredAt',
  ]);
