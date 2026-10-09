/**
 * The settings kinds this deployment serves over MCP: each kind's handler,
 * registered beside the native writer it calls (`backend/domains/<domain>/
 * settings-resource.ts`). A kind the shared descriptors name without a
 * handler here is answered as not available on this deployment.
 */

import type { SettingsRegistry } from './registry.ts';

export const SETTINGS_HANDLERS: SettingsRegistry = {};
