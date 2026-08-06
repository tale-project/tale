import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { jsonRecordValidator } from '../lib/validators/json';

export const conversationsTable = defineTable({
  organizationId: v.string(),
  // The contact this conversation is with (issue #2618) — the sole link to the
  // person on the conversation.
  contactId: v.optional(v.id('contacts')),
  // The internal member who owns this conversation (Better Auth userId). Human
  // members only — notifications only ever target a user. Absent ⇒ unassigned,
  // and message/assignment notifications fall back to org admins.
  assigneeUserId: v.optional(v.string()),
  // The internal team this conversation is queued to (Better Auth teamId). A
  // team "queue" — may be set alongside assigneeUserId (an individual owner
  // within/for that team). Absent ⇒ not team-queued. Drives built-in
  // team-scoped visibility in the conversations RLS rules.
  assigneeTeamId: v.optional(v.string()),
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
  connectorName: v.optional(v.string()),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_priority', ['organizationId', 'priority'])
  .index('by_organizationId_and_contactId', ['organizationId', 'contactId'])
  .index('by_organizationId_and_assignee', ['organizationId', 'assigneeUserId'])
  .index('by_organizationId_and_assigneeTeam', [
    'organizationId',
    'assigneeTeamId',
  ])
  .index('by_organizationId_and_direction', ['organizationId', 'direction'])
  .index('by_organizationId_and_channel', ['organizationId', 'channel'])
  .index('by_organizationId_and_type', ['organizationId', 'type'])
  .index('by_organizationId_and_externalMessageId', [
    'organizationId',
    'externalMessageId',
  ])
  .index('by_org_lastMessageAt', ['organizationId', 'lastMessageAt'])
  .index('by_org_status_lastMessageAt', [
    'organizationId',
    'status',
    'lastMessageAt',
  ])
  .index('by_org_connector_status_lastMessageAt', [
    'organizationId',
    'connectorName',
    'status',
    'lastMessageAt',
  ])
  .index('by_org_connector_channel', [
    'organizationId',
    'connectorName',
    'channel',
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
  connectorName: v.optional(v.string()),
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
  ])
  .index('by_org_channel_direction_deliveryState_connector_deliveredAt', [
    'organizationId',
    'channel',
    'direction',
    'deliveryState',
    'connectorName',
    'deliveredAt',
  ]);
