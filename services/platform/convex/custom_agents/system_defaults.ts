/**
 * System Default Agent Definitions
 *
 * These templates define the 6 built-in agents that are seeded into every
 * organization's customAgents table. Users can freely edit these agents
 * (instructions, tools, partners, etc.) using the existing versioning system.
 *
 * The `systemAgentSlug` field serves as a stable identifier for resolving
 * partner agent references across organizations.
 */

import { CHAT_AGENT_INSTRUCTIONS } from '../agents/chat/agent';
import { CRM_AGENT_INSTRUCTIONS } from '../agents/crm/agent';
import { DOCUMENT_AGENT_INSTRUCTIONS } from '../agents/document/agent';
import { INTEGRATION_AGENT_INSTRUCTIONS } from '../agents/integration/agent';
import { WEB_AGENT_INSTRUCTIONS } from '../agents/web/agent';
import { WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS } from '../workflow_engine/instructions/core_instructions';

export interface SystemDefaultAgentTemplate {
  systemAgentSlug: string;
  name: string;
  displayName: string;
  description: string;
  systemInstructions: string;
  toolNames: string[];
  partnerSlugs: string[];
  maxSteps: number;
  timeoutMs: number;
  outputReserve: number;
  modelPreset: 'fast' | 'standard' | 'advanced';
  roleRestriction?: string;
  knowledgeEnabled?: boolean;
  includeOrgKnowledge?: boolean;
}

export const SYSTEM_DEFAULT_AGENT_TEMPLATES: SystemDefaultAgentTemplate[] = [
  {
    systemAgentSlug: 'chat',
    name: 'chat-agent',
    displayName: 'Assistant',
    description: 'General-purpose AI assistant',
    systemInstructions: CHAT_AGENT_INSTRUCTIONS,
    toolNames: ['rag_search', 'web'],
    partnerSlugs: ['document'],
    knowledgeEnabled: true,
    includeOrgKnowledge: true,
    maxSteps: 20,
    timeoutMs: 420_000,
    outputReserve: 4096,
    modelPreset: 'standard',
  },
  {
    systemAgentSlug: 'web',
    name: 'web-assistant',
    displayName: 'Search',
    description: 'Searches the web for the latest information',
    systemInstructions: WEB_AGENT_INSTRUCTIONS,
    toolNames: ['web'],
    partnerSlugs: [],
    maxSteps: 5,
    timeoutMs: 300_000,
    outputReserve: 2048,
    modelPreset: 'fast',
  },
  {
    systemAgentSlug: 'crm',
    name: 'crm-assistant',
    displayName: 'Sales',
    description: 'Looks up customer and product information',
    systemInstructions: CRM_AGENT_INSTRUCTIONS,
    toolNames: ['customer_read', 'product_read'],
    partnerSlugs: [],
    maxSteps: 10,
    timeoutMs: 180_000,
    outputReserve: 2048,
    modelPreset: 'fast',
  },
  {
    systemAgentSlug: 'document',
    name: 'document-assistant',
    displayName: 'Docs',
    description: 'Reads and creates documents (PDF, Word, Excel, etc.)',
    systemInstructions: DOCUMENT_AGENT_INSTRUCTIONS,
    toolNames: ['pdf', 'image', 'docx', 'pptx', 'txt', 'excel'],
    partnerSlugs: [],
    maxSteps: 15,
    timeoutMs: 180_000,
    outputReserve: 4096,
    modelPreset: 'fast',
  },
  {
    systemAgentSlug: 'integration',
    name: 'integration-assistant',
    displayName: 'Connect',
    description: 'Connects and operates with external systems',
    systemInstructions: INTEGRATION_AGENT_INSTRUCTIONS,
    toolNames: [
      'integration',
      'integration_batch',
      'integration_introspect',
      'verify_approval',
    ],
    partnerSlugs: [],
    maxSteps: 20,
    timeoutMs: 180_000,
    outputReserve: 2048,
    modelPreset: 'fast',
    roleRestriction: 'admin_developer',
  },
  {
    systemAgentSlug: 'workflow',
    name: 'workflow-assistant',
    displayName: 'Automate',
    description: 'Creates and manages automation workflows',
    systemInstructions: WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS,
    toolNames: [
      'workflow_read',
      'workflow_examples',
      'update_workflow_step',
      'save_workflow_definition',
      'create_workflow',
      'database_schema',
    ],
    partnerSlugs: [],
    maxSteps: 30,
    timeoutMs: 240_000,
    outputReserve: 2048,
    modelPreset: 'advanced',
    roleRestriction: 'admin_developer',
  },
];
