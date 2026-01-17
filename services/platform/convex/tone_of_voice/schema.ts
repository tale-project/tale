import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const toneOfVoiceTable = defineTable({
  organizationId: v.string(),
  generatedTone: v.optional(v.string()),
  lastUpdated: v.number(),
  metadata: v.optional(jsonRecordValidator),
}).index('by_organizationId', ['organizationId']);

export const exampleMessagesTable = defineTable({
  organizationId: v.string(),
  toneOfVoiceId: v.id('toneOfVoice'),
  content: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_toneOfVoiceId', ['toneOfVoiceId'])
  .index('by_organizationId_and_toneOfVoiceId', [
    'organizationId',
    'toneOfVoiceId',
  ]);
