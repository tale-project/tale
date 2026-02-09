/**
 * Workflow System Type Definitions
 */

import { v } from 'convex/values';

import { stepConfigValidator } from './nodes';

// =============================================================================
// WORKFLOW TYPES
// =============================================================================

export type WorkflowType = 'predefined';

export interface WorkflowDefinition {
  _id: string;
  organizationId: string;
  name: string;
  description?: string;
  version: string;
  status: 'draft' | 'active' | 'inactive' | 'archived';
  workflowType: WorkflowType;
  config?: unknown;
  metadata: {
    createdAt: number;
    createdBy: string;
    updatedAt?: number;
    updatedBy?: string;
  };
}

export interface WorkflowExecution {
  _id: string;
  organizationId: string;
  wfDefinitionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStepSlug: string;
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
  variables: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  triggeredBy: string;
  waitingFor?: string;
  error?: string;
  threadId?: string; // Shared thread for dynamic orchestration workflows
}

export interface WorkflowStep {
  _id: string;
  wfDefinitionId: string;
  stepSlug: string;
  name: string;
  stepType: 'start' | 'trigger' | 'llm' | 'condition' | 'action' | 'loop';
  order: number;
  config: unknown;
  nextSteps: Record<string, string>;

  organizationId: string;
}

// =============================================================================
// STEP EXECUTION TYPES
// =============================================================================

export type StepOutput = {
  type: string;
  data: unknown;
  meta?: Record<string, unknown>;
};

export interface LoopVars {
  // Identifies which step owns/created this loop state
  ownerStepSlug?: string;
  items?: unknown[];
  state?: {
    currentIndex: number;
    totalItems: number;
    iterations: number;
    batchesProcessed: number;
    isComplete: boolean;
  };
  batch?: {
    index: number;
    size: number;
    items: unknown[];
    startIndex: number;
    endIndex: number;
  } | null;
  item?: unknown;
  index?: number;
  // Support for nested loops: parent contains the outer loop's context
  parent?: LoopVars;
}

export interface StepExecutionResult {
  port: string; // required routing port
  // Variables to update in the execution context
  // Loop steps use { loop: LoopVars }, other steps can update any variables
  variables?: Record<string, unknown>;
  output: StepOutput;
  error?: string;
  threadId?: string;
  approvalTaskId?: string;
  // Full output data for manager to store (not persisted in steps table)
  fullOutputData?: StepOutput;
}

export interface StepExecutionContext {
  stepDef: WorkflowStep;
  variables: Record<string, unknown>;
  executionId: string; // Can be either string or Id<"wfExecutions">
  threadId?: string;
}

// =============================================================================
// VALIDATORS
// =============================================================================

// Workflow type validator
export const workflowTypeValidator = v.literal('predefined');

// Trigger configuration now lives in wfStepDefs.config for the first step

export const workflowMetadataValidator = v.object({
  createdAt: v.number(),
  createdBy: v.string(),
  updatedAt: v.optional(v.number()),
  updatedBy: v.optional(v.string()),
});

export const stepNextStepsValidator = v.record(v.string(), v.string());

export const workflowStepValidator = v.object({
  _id: v.string(),
  wfDefinitionId: v.string(),
  stepSlug: v.string(),
  name: v.string(),
  stepType: v.union(
    v.literal('start'),
    v.literal('trigger'),
    v.literal('agent'),
    v.literal('llm'),
    v.literal('condition'),
    v.literal('action'),
    v.literal('loop'),
  ),
  order: v.number(),
  config: stepConfigValidator,
  nextSteps: stepNextStepsValidator,
  organizationId: v.string(),
});

// =============================================================================
// COMPONENT WORKFLOW TYPES
// =============================================================================

export type ComponentRunResult =
  | { kind: 'success'; returnValue?: StepExecutionResult }
  | { kind: 'failed'; error?: string }
  | { kind: 'canceled' };
