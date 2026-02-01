/**
 * Type-safe function references for agent modules.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from './create_ref';

type GenerateResponseArgs = {
  threadId: string;
  userId?: string;
  organizationId: string;
  taskDescription: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
};

type GenerateResponseResult = {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  durationMs: number;
  model?: string;
  provider?: string;
};

type GenerateResponseRef = FunctionReference<
  'action',
  'internal',
  GenerateResponseArgs,
  GenerateResponseResult
>;

type WorkflowGenerateResponseRef = FunctionReference<
  'action',
  'internal',
  GenerateResponseArgs & { delegationMode?: boolean },
  GenerateResponseResult
>;

type IntegrationGenerateResponseRef = FunctionReference<
  'action',
  'internal',
  GenerateResponseArgs & { integrationsInfo?: string },
  GenerateResponseResult
>;

export function getWebAgentGenerateResponseRef(): GenerateResponseRef {
  return createRef<GenerateResponseRef>('internal', ['agents', 'web', 'actions', 'generateResponse']);
}

export function getCrmAgentGenerateResponseRef(): GenerateResponseRef {
  return createRef<GenerateResponseRef>('internal', ['agents', 'crm', 'actions', 'generateResponse']);
}

export function getDocumentAgentGenerateResponseRef(): GenerateResponseRef {
  return createRef<GenerateResponseRef>('internal', ['agents', 'document', 'actions', 'generateResponse']);
}

export function getIntegrationAgentGenerateResponseRef(): IntegrationGenerateResponseRef {
  return createRef<IntegrationGenerateResponseRef>('internal', ['agents', 'integration', 'actions', 'generateResponse']);
}

export function getWorkflowAgentGenerateResponseRef(): WorkflowGenerateResponseRef {
  return createRef<WorkflowGenerateResponseRef>('internal', ['agents', 'workflow', 'actions', 'generateResponse']);
}
