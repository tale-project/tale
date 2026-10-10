/**
 * The settings kinds this deployment serves over MCP: each kind's handler,
 * registered beside the native writer it calls (`backend/domains/<domain>/
 * settings-resource.ts`). Every kind the shared descriptors name has one —
 * the type holds it, so a new kind cannot be described without its handler.
 */

import type { SettingsKind } from '@tale/shared/schemas/settings-kinds';

import { brandingSettings } from '../../branding/settings-resource.ts';
import { deploymentSettings } from '../../deployment/settings-resource.ts';
import { governanceSettings } from '../../governance/settings-resource.ts';
import { knowledgeEmbeddingSettings } from '../../knowledge/settings-resource.ts';
import {
  agentInstructionsSettings,
  agentModelSettings,
  agentToolsSettings,
  projectInstructionsSettings,
} from '../../projects/settings-resource.ts';
import { providerCredentialSettings } from '../../provider_credentials/settings-resource.ts';
import { providerSettings } from '../../providers/settings-resource.ts';
import {
  taskInstructionsSettings,
  taskReviewContextSettings,
} from '../../tasks/settings-resource.ts';
import type { SettingsKindHandler } from './registry.ts';

export const SETTINGS_HANDLERS: Readonly<
  Record<SettingsKind, SettingsKindHandler>
> = {
  provider: providerSettings,
  'provider-credential': providerCredentialSettings,
  governance: governanceSettings,
  'knowledge-embedding': knowledgeEmbeddingSettings,
  branding: brandingSettings,
  'project-instructions': projectInstructionsSettings,
  'agent-instructions': agentInstructionsSettings,
  'agent-tools': agentToolsSettings,
  'agent-model': agentModelSettings,
  'task-instructions': taskInstructionsSettings,
  'task-review-context': taskReviewContextSettings,
  deployment: deploymentSettings,
};
