import { z } from 'zod';

import { visionModelConfigSchema } from '../../../../../services/platform/lib/shared/schemas/governance';
import { knowledgeEmbeddingSchema } from '../../../../../services/platform/lib/shared/schemas/knowledge';
import { providerDefinitionSchema } from '../../../../../services/platform/lib/shared/schemas/providers';
import { externalDepError } from '../../utils/fail';
import { valueHash } from '../config/releases/identity';
import { sha, slug } from '../config/releases/model';
import type { ModelSettings } from './model-settings';

const nativeModelSettingsProofSchema = z.object({
  configured: z.literal(true),
  organizationId: z.string().min(1).max(256),
  organizationSlug: slug,
  deploymentBundleSha256: sha,
  settingsSha256: sha,
  providers: z
    .array(
      z.object({
        name: providerDefinitionSchema.shape.name,
        models: z.array(z.string().min(1).max(200)).min(1).max(200),
        providerFileSha256: sha,
      }),
    )
    .min(1)
    .max(32),
  vision: visionModelConfigSchema.nullable(),
  embedding: knowledgeEmbeddingSchema.nullable(),
  unchanged: z.boolean(),
});

export function verifyNativeModelSettingsProof(
  input: unknown,
  settings: ModelSettings,
  deploymentBundleSha256: string,
  organizationId: string,
  organizationSlug: string,
) {
  const parsed = nativeModelSettingsProofSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.organizationId !== organizationId ||
    parsed.data.organizationSlug !== organizationSlug ||
    parsed.data.deploymentBundleSha256 !== deploymentBundleSha256 ||
    parsed.data.settingsSha256 !== valueHash(settings) ||
    valueHash(parsed.data.vision) !== valueHash(settings.vision ?? null) ||
    valueHash(parsed.data.embedding) !==
      valueHash(settings.embedding ?? null) ||
    valueHash(
      parsed.data.providers.map(({ name, models }) => ({ name, models })),
    ) !==
      valueHash(
        settings.providers.map(({ definition, models }) => ({
          name: definition.name,
          models: models.map((model) => model.id),
        })),
      )
  )
    throw externalDepError(
      'Native model settings receipt differs from the reviewed organization, declaration or policies.',
    );
  return parsed.data;
}
