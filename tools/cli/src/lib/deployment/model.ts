import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

import { isValidProjectKey } from '../../../../../services/platform/lib/shared/project_key';
import { PROJECT_NAME_MAX } from '../../../../../services/platform/lib/shared/schemas/projects';
import { preconditionError } from '../../utils/fail';
import { gitSha, owner, relativePath, slug } from '../config/releases/model';
import { modelSettingsSchema } from './model-settings';

const text = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\x00-\x1f\x7f]+(?![\s\S])/);
const environmentName = z.string().regex(/^[A-Z][A-Z0-9_]*(?![\s\S])/);

/** Values belonging to the destination stay in its environment. A prepared
 * bundle carries only the variable names, never the resolved credentials. */
export const environmentReference = z.strictObject({
  env: environmentName,
  optional: z.boolean().optional(),
});
const value = z.union([text, environmentReference]);
const origin = text.refine((input) => {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'https:' && parsed.origin === input;
  } catch {
    return false;
  }
}, 'expected a canonical HTTPS origin');
const githubRepository = text.refine(
  (input) =>
    /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+(?![\s\S])/.test(
      input,
    ) &&
    !input.endsWith('.git') &&
    new URL(input).href === input,
  'expected a canonical GitHub repository URL',
);
const ref = z.union([gitSha, environmentReference]);
const project = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}(?![\s\S])/);
const stateDirectory = text.refine(
  (input) => isAbsolute(input) && resolve(input) === input && input !== '/',
  'expected a canonical absolute state directory',
);
const redirectUri = text.url().refine((input) => {
  const parsed = new URL(input);
  return (
    parsed.protocol === 'https:' &&
    !parsed.username &&
    !parsed.password &&
    !parsed.hash
  );
});
const nativeClient = z.strictObject({
  key: slug,
  name: text,
  clientId: value.optional(),
  managed: z.literal(true).optional(),
  redirectUris: z.array(redirectUri).min(1).max(16),
});
const identity = z.strictObject({
  bootstrap: z.literal('fresh').optional(),
  emailVerification: z.literal('operator-attested').optional(),
  email: value,
  password: environmentReference.optional(),
  slug,
  name: text,
  ssoEnabled: z.boolean(),
  tenantId: environmentReference.optional(),
  clientId: environmentReference.optional(),
  clientSecret: environmentReference.optional(),
  nativeClients: z.array(nativeClient).max(16).default([]),
});

export const managedProjectSchema = z.strictObject({
  key: text.refine(
    isValidProjectKey,
    'expected a native uppercase project key',
  ),
  name: text.max(PROJECT_NAME_MAX).refine((input) => input.trim() === input),
});

const deploymentFields = z.strictObject({
  schemaVersion: z.literal(1),
  name: slug,
  stateDirectory,
  composeProject: project,
  runtime: z.strictObject({
    revision: ref,
    platform: z.enum(['linux/amd64', 'linux/arm64']).default('linux/amd64'),
  }),
  origin,
  tlsMode: z.enum(['external', 'letsencrypt']),
  tlsEmail: z.string().email().optional(),
  environment: z.record(environmentName, environmentReference).default({}),
  identity: identity.optional(),
  modelSettings: modelSettingsSchema.optional(),
  configs: z
    .array(
      z.strictObject({
        repository: githubRepository,
        revision: ref,
        client: slug,
        descriptor: relativePath,
        automation: slug,
        projectId: text.optional(),
        project: managedProjectSchema.optional(),
        skillOwner: z.union([z.literal('operator'), owner]).optional(),
        /** Preserve an adopted deployment's existing receipt for crash recovery. */
        receiptPath: relativePath
          .refine(
            (input) => input.startsWith('ops/') && input.endsWith('.json'),
            'receipt must be an ops JSON record',
          )
          .optional(),
      }),
    )
    .max(64)
    .default([]),
});

export const deploymentSpecSchema = deploymentFields.superRefine(
  (spec, context) => {
    if (spec.identity?.emailVerification && spec.identity.bootstrap !== 'fresh')
      context.addIssue({
        code: 'custom',
        message: 'Operator email attestation requires explicit fresh bootstrap',
        path: ['identity', 'emailVerification'],
      });
    if (spec.tlsMode === 'letsencrypt' && !spec.tlsEmail)
      context.addIssue({
        code: 'custom',
        message: 'ACME contact email is required',
        path: ['tlsEmail'],
      });
    if (spec.configs.length && !spec.identity)
      context.addIssue({
        code: 'custom',
        message: 'Configuration deployment requires an organization identity',
        path: ['identity'],
      });
    if (spec.modelSettings && !spec.identity)
      context.addIssue({
        code: 'custom',
        message: 'Model settings require an organization identity',
        path: ['identity'],
      });
    for (const provider of spec.modelSettings?.providers ?? []) {
      const reference = spec.environment[provider.credential.envName];
      if (!reference || reference.optional)
        context.addIssue({
          code: 'custom',
          message:
            'Provider credential needs an explicit required deployment environment reference',
          path: ['environment', provider.credential.envName],
        });
    }
    if (spec.identity?.ssoEnabled)
      for (const field of ['tenantId', 'clientId', 'clientSecret'] as const)
        if (!spec.identity[field])
          context.addIssue({
            code: 'custom',
            message: 'Entra environment reference is required',
            path: ['identity', field],
          });
    const identities = spec.configs.map(
      (config) => `${config.client}/${config.automation}`,
    );
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate configuration target',
        path: ['configs'],
      });
    const projects = new Map<string, string>();
    for (const [index, config] of spec.configs.entries()) {
      if ((config.projectId === undefined) === (config.project === undefined))
        context.addIssue({
          code: 'custom',
          message: 'Select exactly one native project target',
          path: ['configs', index],
        });
      if (config.project) {
        const previous = projects.get(config.project.key);
        if (previous !== undefined && previous !== config.project.name)
          context.addIssue({
            code: 'custom',
            message: 'Managed project key has conflicting names',
            path: ['configs', index, 'project'],
          });
        projects.set(config.project.key, config.project.name);
      }
    }
    const clients = spec.identity?.nativeClients ?? [];
    if (new Set(clients.map((client) => client.key)).size !== clients.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate native client key',
        path: ['identity', 'nativeClients'],
      });
    for (const [index, client] of clients.entries())
      if ((client.clientId === undefined) === (client.managed === undefined))
        context.addIssue({
          code: 'custom',
          message: 'Select exactly one native client identity',
          path: ['identity', 'nativeClients', index],
        });
  },
);

// Fleet address registries may supply public URLs during preparation. Persist
// their resolved values so deployment never silently follows a changed address.
// The finished bundle deliberately has the narrower schema above.
const deploymentInputSchema = deploymentFields.extend({
  origin: z.union([origin, environmentReference]),
  identity: identity
    .extend({
      nativeClients: z
        .array(
          nativeClient.extend({
            redirectUris: z
              .array(z.union([redirectUri, environmentReference]))
              .min(1)
              .max(16),
          }),
        )
        .max(16)
        .default([]),
    })
    .optional(),
});

export type DeploymentSpec = z.infer<typeof deploymentSpecSchema>;
export type EnvironmentReference = z.infer<typeof environmentReference>;

export function resolveValue(
  input: string | EnvironmentReference,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof input === 'string') return input;
  const resolved = environment[input.env];
  if (resolved === undefined || resolved === '') {
    if (input.optional) return '';
    throw preconditionError(
      `Required deployment environment variable ${input.env} is missing.`,
    );
  }
  // Credentials may contain punctuation and spaces, but never line-oriented
  // protocol delimiters. Reject without echoing the secret back to the caller.
  if (/[\x00-\x1f\x7f]/.test(resolved))
    throw preconditionError(
      `Deployment environment variable ${input.env} contains control characters.`,
    );
  return resolved;
}

/** Resolve only public source pins and URLs during preparation. Host credential
 * references survive unchanged until the backend-local provisioning phase. */
export function resolveDeploymentSpec(
  input: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentSpec {
  const spec = deploymentInputSchema.parse(input);
  return deploymentSpecSchema.parse({
    ...spec,
    origin: resolveValue(spec.origin, environment),
    identity: spec.identity && {
      ...spec.identity,
      nativeClients: spec.identity.nativeClients.map((client) =>
        Object.assign({}, client, {
          redirectUris: client.redirectUris.map((uri) =>
            resolveValue(uri, environment),
          ),
        }),
      ),
    },
    runtime: {
      ...spec.runtime,
      revision: gitSha.parse(resolveValue(spec.runtime.revision, environment)),
    },
    configs: spec.configs.map((config) =>
      Object.assign({}, config, {
        revision: gitSha.parse(resolveValue(config.revision, environment)),
      }),
    ),
  });
}
