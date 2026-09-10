import { z } from 'zod';

export const slug = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/)
  .max(100);
export const version = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/);
export const sha = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
export const gitSha = z.string().regex(/^[a-f0-9]{40}(?![\s\S])/);
export const owner = z.string().regex(/^[A-Za-z0-9_-]{8,128}(?![\s\S])/);
export const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value
        .split('/')
        .every(
          (part) =>
            part !== '' &&
            part !== '.' &&
            part !== '..' &&
            !/[\\\x00-\x1f:]/.test(part),
        ),
    'unsafe relative path',
  );
export const repository = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !value.endsWith('/')
    );
  }, 'source repository must be an HTTPS URL without credentials');
const unique = (values: string[]) => new Set(values).size === values.length;
const slugs = z.array(slug).refine(unique, 'duplicate skill slug');
export const automationSchema = z
  .strictObject({
    name: slug,
    displayName: z.string().min(1).max(200),
    packPath: relativePath,
    releasesPath: relativePath,
    logicalSkillSlugs: slugs,
    requiredExternalSkills: slugs,
    historicalReleases: z
      .array(
        z.strictObject({
          version,
          manifestSha256: sha,
          sourceRepository: repository,
          packPath: relativePath,
          allowExistingNativeReuse: z.boolean(),
          sourceArchive: z.strictObject({
            path: relativePath,
            sha256: sha,
            bytes: z.number().int().positive().safe(),
          }),
        }),
      )
      .default([]),
  })
  .refine(
    (value) => unique(value.historicalReleases.map((item) => item.version)),
    'duplicate historical release',
  )
  .refine(
    (value) =>
      !value.logicalSkillSlugs.some((item) =>
        value.requiredExternalSkills.includes(item),
      ),
    'owned and external skills overlap',
  );
export const clientSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clientId: slug,
    sourceRepository: repository,
    automations: z.array(automationSchema).min(1),
  })
  .refine(
    (value) => unique(value.automations.map((item) => item.name)),
    'duplicate automation',
  )
  .refine(
    (value) => unique(value.automations.map((item) => item.releasesPath)),
    'automations must have separate release catalogues',
  );
export type Client = z.infer<typeof clientSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type HistoricalRelease = Automation['historicalReleases'][number];
export interface ClientAutomation {
  client: Client;
  automation: Automation;
  descriptorPath: string;
}
export const artifactSchema = z.strictObject({
  path: relativePath,
  sha256: sha,
  bytes: z.number().int().positive().safe(),
});
const skillArtifactSchema = artifactSchema.extend({ slug });
const bindingSchema = z.strictObject({ logicalSlug: slug, releaseSlug: slug });
export const manifestSchema = z
  .strictObject({
    schemaVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    version: version.optional(),
    releaseRef: gitSha.optional(),
    sourceCommit: gitSha,
    packTree: gitSha,
    packPath: relativePath,
    automationName: slug,
    displayName: z.string().min(1),
    artifact: artifactSchema,
    documentSha256: sha,
    settingsSha256: sha,
    skillSlugs: slugs,
    skillFiles: z.array(
      z.strictObject({
        slug,
        path: relativePath,
        sha256: sha,
        bytes: z.number().int().nonnegative().safe(),
      }),
    ),
    compilerVersion: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .optional(),
    skillOwnerUserId: owner.optional(),
    skillBindings: z.array(bindingSchema).optional(),
    requiredExternalSkills: slugs.optional(),
    presentationSha256: sha.optional(),
    taskContractSha256: sha.optional(),
    installArtifacts: z
      .strictObject({
        workflow: artifactSchema,
        skills: z.array(skillArtifactSchema),
      })
      .optional(),
    clientId: slug.optional(),
    sourceRepository: repository.optional(),
    descriptorPath: relativePath.optional(),
    descriptorSha256: sha.optional(),
  })
  .refine(
    (value) =>
      value.schemaVersion === 4
        ? value.version === undefined && value.releaseRef === value.sourceCommit
        : value.version !== undefined && value.releaseRef === undefined,
    'release identity must match its schema and full source commit',
  );
export type Manifest = z.infer<typeof manifestSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type SkillBinding = z.infer<typeof bindingSchema>;
export interface ArtifactBytes {
  artifactPath: string;
  bytes: Buffer;
}
export interface Installation {
  workflow: ArtifactBytes;
  skills: (ArtifactBytes & { slug: string })[];
}
export interface LoadedRelease extends ArtifactBytes {
  manifest: Manifest;
  installation?: Installation;
  historical?: HistoricalRelease;
}
export type Json =
  | null
  | boolean
  | string
  | number
  | Json[]
  | { [key: string]: Json };
export type RecordValue = Record<string, unknown>;
export function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export class ConfigError extends Error {}
export class NativeRequestError extends Error {}
export class ExternalToolError extends Error {}
export function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConfigError(message);
}
export function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
