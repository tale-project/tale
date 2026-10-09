/**
 * The settings tools as the MCP endpoint calls them: `get_settings`,
 * `plan_settings` and `apply_settings` over the registry of the kinds this
 * deployment serves. The call's arguments were checked against the tool's
 * schema before it got here; they are read back through the same schema so
 * each tool gets them typed.
 */

import type { Sql } from 'postgres';

import { PLATFORM_TOOL_ARGS } from '../../../../lib/mcp/args.ts';
import type { McpCaller } from '../caller.ts';
import { applySettings } from './apply.ts';
import { getSettings } from './get.ts';
import { planSettings } from './plan.ts';
import { SETTINGS_HANDLERS, type SettingsRegistry } from './registry.ts';

/** One settings tool, acting as the caller in the caller's organization. */
export async function dispatchSettingsTool(
  sql: Sql,
  caller: McpCaller,
  method: 'get_settings' | 'plan_settings' | 'apply_settings',
  params: Record<string, unknown>,
  registry: SettingsRegistry = SETTINGS_HANDLERS,
): Promise<Record<string, unknown>> {
  const ctx = { sql, caller };
  switch (method) {
    case 'get_settings':
      return getSettings(
        ctx,
        registry,
        PLATFORM_TOOL_ARGS.get_settings.parse(params),
      );
    case 'plan_settings':
      return planSettings(
        ctx,
        registry,
        PLATFORM_TOOL_ARGS.plan_settings.parse(params).changes,
      );
    case 'apply_settings': {
      const { changes, expected } =
        PLATFORM_TOOL_ARGS.apply_settings.parse(params);
      return applySettings(ctx, registry, changes, expected);
    }
    default: {
      const unknown: never = method;
      throw new Error(`No settings tool "${String(unknown)}"`);
    }
  }
}
