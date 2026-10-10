import {
  platformConfigurationSchema,
  type PlatformConfiguration,
} from '@tale/shared/config/platform-resources';
import { z } from 'zod';

import { usageError } from '../../utils/fail';
import { sha } from './releases/model';

/** The native resource model (schema, identity, declaration rules,
 * convergence) is shared with the platform in
 * `@tale/shared/config/platform-resources`; what stays here is the CLI's own:
 * its usage error and the plan file it saves for review. */
export function parsePlatformConfiguration(
  input: unknown,
): PlatformConfiguration {
  // The shared schema already refuses a field that parsing would discard.
  const parsed = platformConfigurationSchema.safeParse(input);
  if (!parsed.success)
    throw usageError(
      'Platform configuration contains unsupported resources or invalid native fields.',
    );
  return parsed.data;
}

// Hashes and opaque native revisions make a plan safe to save and review: it
// carries neither a session cookie nor arbitrary configuration/secret values.
export const configurationTargetSchema = z.strictObject({
  origin: z.string().url(),
  organizationId: z.string().min(1).max(128),
  organizationSlug: z.string().min(1).max(64),
});
export const configurationPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  configurationSha256: sha,
  target: configurationTargetSchema,
  resources: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(1024),
        scope: z.enum(['organization', 'instance']),
        currentSha256: sha,
        desiredSha256: sha,
        revision: z.string().max(200).nullable(),
        action: z.enum(['create', 'update', 'unchanged']),
        effects: z.array(
          z.enum(['restart-required', 'embedding-configuration']),
        ),
      }),
    )
    .min(1)
    .max(128),
});
export type ConfigurationPlan = z.infer<typeof configurationPlanSchema>;
