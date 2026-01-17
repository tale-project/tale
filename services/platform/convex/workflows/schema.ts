import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../lib/shared/schemas/utils/json-value';

export const wfDefinitionsTable = defineTable({
  organizationId: v.string(),
  version: v.string(),
  versionNumber: v.number(),
  status: v.string(),
  workflowType: v.literal('predefined'),
  name: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  config: v.optional(
    v.object({
      timeout: v.optional(v.number()),
      retryPolicy: v.optional(
        v.object({
          maxRetries: v.number(),
          backoffMs: v.number(),
        }),
      ),
      variables: v.optional(v.record(v.string(), jsonValueValidator)),
      secrets: v.optional(
        v.record(
          v.string(),
          v.object({
            kind: v.literal('inlineEncrypted'),
            cipherText: v.string(),
            keyId: v.optional(v.string()),
          }),
        ),
      ),
    }),
  ),
  rootVersionId: v.optional(v.id('wfDefinitions')),
  parentVersionId: v.optional(v.id('wfDefinitions')),
  publishedAt: v.optional(v.number()),
  publishedBy: v.optional(v.string()),
  changeLog: v.optional(v.string()),
  userRequirement: v.optional(
    v.object({
      goal: v.string(),
      context: v.optional(v.string()),
      constraints: v.optional(v.array(v.string())),
      expectedOutcome: v.optional(v.string()),
    }),
  ),
  availableAgentTypes: v.optional(v.array(v.string())),
  globalConfig: v.optional(jsonRecordValidator),
  plannerConfig: v.optional(
    v.object({
      model: v.optional(v.string()),
      temperature: v.optional(v.number()),
      maxSteps: v.optional(v.number()),
    }),
  ),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_org', ['organizationId'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_status', ['status'])
  .index('by_org_and_name', ['organizationId', 'name'])
  .index('by_org_name_version', ['organizationId', 'name', 'versionNumber'])
  .index('by_org_name_status', ['organizationId', 'name', 'status'])
  .index('by_rootVersionId', ['rootVersionId']);

export const wfStepDefsTable = defineTable({
  organizationId: v.string(),
  wfDefinitionId: v.id('wfDefinitions'),
  stepSlug: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  stepType: v.union(
    v.literal('trigger'),
    v.literal('llm'),
    v.literal('condition'),
    v.literal('action'),
    v.literal('loop'),
  ),
  order: v.number(),
  nextSteps: v.record(v.string(), v.string()),
  config: stepConfigValidator,
  inputMapping: v.optional(v.record(v.string(), v.string())),
  outputMapping: v.optional(v.record(v.string(), v.string())),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_definition', ['wfDefinitionId'])
  .index('by_definition_order', ['wfDefinitionId', 'order'])
  .index('by_step_slug', ['wfDefinitionId', 'stepSlug'])
  .index('by_organizationId_and_stepType_and_order', [
    'organizationId',
    'stepType',
    'order',
  ]);

export const wfExecutionsTable = defineTable({
  organizationId: v.string(),
  wfDefinitionId: v.union(v.id('wfDefinitions'), v.string(), v.null()),
  rootWfDefinitionId: v.optional(v.id('wfDefinitions')),
  workflowSlug: v.optional(v.string()),
  workflowVersion: v.optional(v.string()),
  status: v.string(),
  currentStepSlug: v.string(),
  waitingFor: v.optional(v.string()),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  componentWorkflowId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  variables: v.optional(v.string()),
  variablesStorageId: v.optional(v.id('_storage')),
  input: v.optional(jsonValueValidator),
  output: v.optional(jsonValueValidator),
  workflowConfig: v.optional(v.string()),
  stepsConfig: v.optional(v.string()),
  triggeredBy: v.optional(v.string()),
  triggerData: v.optional(jsonValueValidator),
  error: v.optional(v.string()),
  metadata: v.optional(v.string()),
})
  .index('by_org', ['organizationId'])
  .index('by_definition', ['wfDefinitionId'])
  .index('by_definition_startedAt', ['wfDefinitionId', 'startedAt'])
  .index('by_status', ['status'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_component_workflow', ['componentWorkflowId']);

export const workflowProcessingRecordsTable = defineTable({
  organizationId: v.string(),
  tableName: v.string(),
  recordId: v.string(),
  wfDefinitionId: v.string(),
  recordCreationTime: v.number(),
  processedAt: v.number(),
  status: v.optional(
    v.union(v.literal('in_progress'), v.literal('completed')),
  ),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_org_table_wfDefinition', [
    'organizationId',
    'tableName',
    'wfDefinitionId',
  ])
  .index('by_org_table_wfDefinition_creationTime', [
    'organizationId',
    'tableName',
    'wfDefinitionId',
    'recordCreationTime',
  ])
  .index('by_org_table_wfDefinition_processedAt', [
    'organizationId',
    'tableName',
    'wfDefinitionId',
    'processedAt',
  ])
  .index('by_record', ['tableName', 'recordId', 'wfDefinitionId']);
