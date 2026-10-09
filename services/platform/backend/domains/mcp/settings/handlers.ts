/**
 * The settings kinds this deployment serves over MCP: each kind's handler,
 * registered beside the native writer it calls (`backend/domains/<domain>/
 * settings-resource.ts`). A kind the shared descriptors name without a
 * handler here is answered as not available on this deployment.
 */

import { brandingSettings } from '../../branding/settings-resource.ts';
import { deploymentSettings } from '../../deployment/settings-resource.ts';
import { governanceSettings } from '../../governance/settings-resource.ts';
import { knowledgeEmbeddingSettings } from '../../knowledge/settings-resource.ts';
import type { SettingsRegistry } from './registry.ts';

export const SETTINGS_HANDLERS: SettingsRegistry = {
  governance: governanceSettings,
  'knowledge-embedding': knowledgeEmbeddingSettings,
  branding: brandingSettings,
  deployment: deploymentSettings,
};
