/**
 * Built-in Agent Registry
 *
 * Defines the available built-in agents and their configs for direct chat.
 * Each built-in agent can be used standalone (bypassing the routing agent).
 */

import { v } from 'convex/values';

import type { ToolName } from '../agent_tools/tool_registry';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import type { AgentType } from '../lib/context_management/constants';

import { mutation, query } from '../_generated/server';
import { authComponent } from '../auth';
import { startAgentChat } from '../lib/agent_chat';
import {
  getCodingModel,
  getDefaultAgentRuntimeConfig,
} from '../lib/agent_runtime_config';
import { WORKFLOW_AGENT_CORE_INSTRUCTIONS } from '../workflow_engine/instructions/core_instructions';
import { CHAT_AGENT_INSTRUCTIONS } from './chat/agent';
import { createChatHookHandles } from './chat/config';
import { CRM_AGENT_INSTRUCTIONS } from './crm/agent';
import { DOCUMENT_AGENT_INSTRUCTIONS } from './document/agent';
import { INTEGRATION_AGENT_INSTRUCTIONS } from './integration/agent';
import { WEB_AGENT_INSTRUCTIONS } from './web/agent';

export const BUILTIN_AGENT_TYPES = [
  'chat',
  'web',
  'crm',
  'document',
  'integration',
  'workflow',
] as const;

export type BuiltinAgentType = (typeof BUILTIN_AGENT_TYPES)[number];

interface BuiltinAgentDefinition {
  type: BuiltinAgentType;
  agentType: AgentType;
  name: string;
  displayName: string;
  description: string;
  instructions: string;
  toolNames: ToolName[];
  maxSteps: number;
  model?: string;
  contextFeatures?: string[];
}

function getBuiltinAgentDefinitions(): BuiltinAgentDefinition[] {
  return [
    {
      type: 'chat',
      agentType: 'chat',
      name: 'routing-agent',
      displayName: 'Assistant',
      description:
        'General-purpose AI assistant that routes to specialized agents',
      instructions: CHAT_AGENT_INSTRUCTIONS,
      toolNames: [
        'rag_search',
        'web',
        'document_assistant',
        'integration_assistant',
        'workflow_assistant',
        'crm_assistant',
        'request_human_input',
      ],
      maxSteps: 20,
      contextFeatures: ['integrations'],
    },
    {
      type: 'web',
      agentType: 'web',
      name: 'web-assistant',
      displayName: 'Search',
      description: 'Searches the web and retrieves the latest information',
      instructions: WEB_AGENT_INSTRUCTIONS,
      toolNames: ['web'],
      maxSteps: 5,
      contextFeatures: [],
    },
    {
      type: 'crm',
      agentType: 'crm',
      name: 'crm-assistant',
      displayName: 'Sales',
      description: 'Looks up customer and product information',
      instructions: CRM_AGENT_INSTRUCTIONS,
      toolNames: ['customer_read', 'product_read'],
      maxSteps: 10,
      contextFeatures: [],
    },
    {
      type: 'document',
      agentType: 'document',
      name: 'document-assistant',
      displayName: 'Docs',
      description: 'Reads and creates documents (PDF, Word, Excel, etc.)',
      instructions: DOCUMENT_AGENT_INSTRUCTIONS,
      toolNames: ['pdf', 'image', 'docx', 'pptx', 'txt', 'excel'],
      maxSteps: 15,
      contextFeatures: [],
    },
    {
      type: 'integration',
      agentType: 'integration',
      name: 'integration-assistant',
      displayName: 'Connect',
      description: 'Connects and operates with external systems',
      instructions: INTEGRATION_AGENT_INSTRUCTIONS,
      toolNames: [
        'integration',
        'integration_batch',
        'integration_introspect',
        'verify_approval',
      ],
      maxSteps: 20,
      contextFeatures: ['integrations'],
    },
    {
      type: 'workflow',
      agentType: 'workflow',
      name: 'workflow-assistant',
      displayName: 'Automate',
      description: 'Creates automated workflows',
      instructions: WORKFLOW_AGENT_CORE_INSTRUCTIONS,
      toolNames: [
        'workflow_read',
        'workflow_examples',
        'update_workflow_step',
        'save_workflow_definition',
        'create_workflow',
        'database_schema',
      ],
      maxSteps: 30,
      contextFeatures: [],
    },
  ];
}

function toSerializableConfig(
  def: BuiltinAgentDefinition,
): SerializableAgentConfig {
  const config: SerializableAgentConfig = {
    name: def.name,
    instructions: def.instructions,
    convexToolNames: def.toolNames,
    maxSteps: def.maxSteps,
    contextFeatures: def.contextFeatures,
  };

  if (def.type === 'workflow') {
    config.model = getCodingModel();
  }

  return config;
}

export const listBuiltinAgents = query({
  args: {},
  returns: v.array(
    v.object({
      type: v.string(),
      displayName: v.string(),
      description: v.string(),
    }),
  ),
  handler: () => {
    return getBuiltinAgentDefinitions().map((def) => ({
      type: def.type,
      displayName: def.displayName,
      description: def.description,
    }));
  },
});

export const chatWithBuiltinAgent = mutation({
  args: {
    builtinAgentType: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    if (
      !(BUILTIN_AGENT_TYPES as readonly string[]).includes(
        args.builtinAgentType,
      )
    ) {
      throw new Error(`Invalid built-in agent type: ${args.builtinAgentType}`);
    }

    const definitions = getBuiltinAgentDefinitions();
    const def = definitions.find((d) => d.type === args.builtinAgentType);
    if (!def) {
      throw new Error(`Built-in agent not found: ${args.builtinAgentType}`);
    }

    const agentConfig = toSerializableConfig(def);
    const { model, provider } = getDefaultAgentRuntimeConfig();
    const hooks = await createChatHookHandles(ctx);

    return startAgentChat({
      ctx,
      agentType: def.agentType,
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig,
      model: agentConfig.model ?? model,
      provider,
      debugTag: `[BuiltinAgent:${def.type}]`,
      enableStreaming: true,
      hooks,
    });
  },
});
