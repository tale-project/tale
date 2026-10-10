import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import { isDeploymentEditor } from '../../core/deployment/editors.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import {
  callerEmail,
  identifySingle,
  parseSettingsConfig,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import {
  DeploymentError,
  type InstanceAdminAuth,
  readDeploymentConfigView,
  requireInstanceAdmin,
  saveDeploymentConfig,
} from './service.ts';

/**
 * This deployment's own settings as a settings kind over MCP
 * (`deployment`): one resource for every organization on the deployment,
 * read and saved through the writer the operator's settings use, behind the
 * same gate — reading takes an owner or admin of any organization, changing
 * additionally an address on the deployment's editor allowlist.
 */

/** The person behind the call as the deployment's gate reads them. */
async function instanceAdmin(
  ctx: SettingsContext,
  write: boolean,
): Promise<InstanceAdminAuth> {
  const email = (await callerEmail(ctx)) ?? '';
  return requireInstanceAdmin(
    ctx.sql,
    { id: ctx.caller.userId, email },
    { write },
  );
}

/**
 * A refusal of the deployment's writer as an agent reads it: a version
 * conflict is the conflict every other writer raises, so the call answers
 * it with the hash stored now; a file the server cannot read is the
 * operator's to repair, not a fault of the call.
 */
function asRefusal(error: unknown): unknown {
  if (!(error instanceof DeploymentError)) return error;
  if (error.code === 'DEPLOYMENT_VERSION_CONFLICT') {
    return new ConfigurationError('CONFIG_VERSION_CONFLICT', error.message);
  }
  if (error.code === 'DEPLOYMENT_CONFIG_UNREADABLE') {
    return new SettingsRefusalError(
      error.code,
      'the deployment settings file cannot be read',
      {
        status: 409,
        hint: 'whoever runs this Tale repairs the file on the server; nothing changes it over MCP until then',
      },
    );
  }
  if (error.status === 500) return error;
  const hint = GATE_HINTS[error.code];
  return new SettingsRefusalError(error.code, error.message, {
    status: error.status,
    ...(hint === undefined ? {} : { hint }),
    ...(Object.keys(error.data).length === 0 ? {} : { data: error.data }),
  });
}

/** What the person behind a refused call can do about the gate. */
const GATE_HINTS: Readonly<Record<string, string>> = {
  FORBIDDEN_INSTANCE_ADMIN:
    'the deployment settings are read by an owner or admin of an organization on this deployment',
  FORBIDDEN_DEPLOYMENT_EDITOR:
    "they are changed only by the addresses on the deployment's editor allowlist, which whoever runs this Tale keeps",
};

async function withRefusals<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asRefusal(error);
  }
}

async function readDeployment(
  ctx: SettingsContext,
): Promise<SettingsResource | null> {
  return withRefusals(async () => {
    const view = await readDeploymentConfigView(
      await instanceAdmin(ctx, false),
    );
    if (view.hash === null) return null;
    return { id: null, config: view.config, hash: view.hash };
  });
}

function sandboxRuntimeOf(config: unknown): unknown {
  return isRecord(config) ? (config.sandboxRuntime ?? null) : null;
}

export const deploymentSettings: SettingsKindHandler = {
  kind: 'deployment',
  access: async (ctx) => {
    try {
      await instanceAdmin(ctx, false);
    } catch (error) {
      if (error instanceof DeploymentError && error.status === 403) {
        return { read: false, write: false };
      }
      throw error;
    }
    return { read: true, write: isDeploymentEditor(await callerEmail(ctx)) };
  },
  identify: identifySingle('deployment'),
  list: async (ctx) => {
    const current = await readDeployment(ctx);
    return { items: current === null ? [] : [current], nextCursor: null };
  },
  read: async (ctx) => readDeployment(ctx),
  plan: async (ctx, change, current) => {
    await withRefusals(() => instanceAdmin(ctx, true));
    const after = parseSettingsConfig(
      deploymentConfigSchema,
      change.config,
      'the deployment settings',
    );
    const effects: SettingsEffect[] = [];
    // The sandbox spawner reads its runtime when the deployment starts.
    if (
      configurationHash(sandboxRuntimeOf(after)) !==
      configurationHash(sandboxRuntimeOf(current?.config ?? null))
    ) {
      effects.push('restart-required');
    }
    return {
      after,
      unchanged:
        current !== null &&
        configurationHash(after) === configurationHash(current.config),
      effects,
    };
  },
  apply: async (ctx, change, expectedHash) =>
    withRefusals(async () => {
      const { hash } = await saveDeploymentConfig(
        ctx.sql,
        await instanceAdmin(ctx, true),
        { config: change.config, expectedHash },
      );
      return { hash };
    }),
};
