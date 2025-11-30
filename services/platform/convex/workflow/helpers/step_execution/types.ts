/**
 * Shared types for step execution
 */

import { Id } from '../../../_generated/dataModel';
import { StepExecutionResult } from '../../types';

export type StepType = 'trigger' | 'llm' | 'condition' | 'action' | 'loop';

export interface StepDefinition {
  stepSlug: string;
  name: string;
  stepType: StepType;
  config: Record<string, unknown>;
  organizationId: string;
}

export interface ExecutionData {
  _id: Id<'wfExecutions'>;
  wfDefinitionId?: Id<'wfDefinitions'> | null;
  stepsConfig?: Record<string, unknown>;
  workflowConfig?: WorkflowConfig;
  variables?: Record<string, unknown>;
  workflowSlug?: string; // Auto-generated from workflow name (snake_case)
}

export interface WorkflowConfig {
  name?: string; // Workflow name (used to generate workflowId)
  description?: string; // Workflow description
  version?: string; // Workflow version
  workflowType?: 'predefined'; // Workflow type
  config?: {
    variables?: Record<string, unknown>;
    secrets?: Record<
      string,
      {
        kind: 'inlineEncrypted';
        cipherText: string;
        keyId?: string;
      }
    >;
    timeout?: number;
    retryPolicy?: {
      maxRetries: number;
      backoffMs: number;
    };
  };
}

export interface StepConfig {
  [key: string]: unknown;
}

export interface InitializeVariablesArgs {
  executionId: string;
  organizationId: string;
  resumeVariables?: unknown;
  initialInput?: unknown;
}

export interface LoadExecutionResult {
  execution: ExecutionData;
  stepConfig: StepConfig;
  workflowConfig: WorkflowConfig;
}

export type { StepExecutionResult };
