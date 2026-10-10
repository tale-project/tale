/**
 * Automation versions on the wire: a version as a history lists it (who
 * saved it, through which door and client, what it was based on, what it
 * changed, how its tests went, whether it is live), the times a version was
 * put live, and the answer of comparing two versions.
 *
 * The shapes are the engine's and the store's: the structural diff and its
 * change summary (`lib/engine/core/diff/`), the version rows a history
 * answers (`listVersions` in the store, `list_versions` in dispatch), the
 * deploys `list_versions` answers beside them. These schemas read them at
 * the boundary, and their tests hold them to what the engine produces.
 *
 * Three doors list versions today, each with the fields it carries: the
 * app's history, the REST listing and the agent tool. A row reads the same
 * from each: a field a door does not send — or a server older than the field
 * did not — reads as unknown (`null`), a flag as not set. A door the version
 * was saved through that this build does not know reads as unknown too, as
 * does one a version saved before doors were recorded.
 */

import { z } from 'zod';

import type { AutomationDiff } from '../../engine/core/diff/automation';
import type { ChangeSummary } from '../../engine/core/diff/changes';
import { diffChangeSchema } from './automation-tests';

/** The doors a version can be saved through (`automations.created_via`):
 * the editor, a package upload, a coding agent over MCP, the REST API,
 * managed configuration, and the platform itself (the shipped packs). */
export const AUTOMATION_WRITE_VIAS = [
  'app',
  'upload',
  'mcp',
  'rest',
  'managed',
  'system',
] as const;

export type AutomationWriteVia = (typeof AUTOMATION_WRITE_VIAS)[number];

const count = z.number().int().nonnegative();
const versionNumber = z.number().int().min(1);

/** A value a door may leave out, read as unknown (`null`) when it does. */
function orNull<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? null);
}

/** A door, or `null` for one this build does not know or none recorded. */
const writeViaSchema = z.enum(AUTOMATION_WRITE_VIAS).nullable().catch(null);

// ---------------------------------------------------------- what changed

const CHANGE_KINDS = ['added', 'removed', 'changed'] as const;

/** What a version changed against the one saved before it: counts and
 * flags only, never content (`changeSummaryOf`). */
export const changeSummarySchema = z.object({
  first: z.literal(true).optional(),
  identical: z.literal(true).optional(),
  nodes: z.object({
    added: count,
    removed: count,
    changed: count,
    renamed: count.optional(),
  }),
  inputs: z.literal(true).optional(),
  output: z.literal(true).optional(),
  description: z.literal(true).optional(),
  tests: z.literal(true).optional(),
  other: z.literal(true).optional(),
  package: z.literal(true).optional(),
}) satisfies z.ZodType<ChangeSummary>;

const renameSchema = z.object({ from: z.string(), to: z.string() });

const fieldChangeSchema = z.object({
  field: z.string(),
  kind: z.enum(CHANGE_KINDS),
  display: z.enum([
    'code',
    'template',
    'condition',
    'json',
    'text',
    'scalar',
    'list',
  ]),
  before: z.json().optional(),
  after: z.json().optional(),
  values: z.array(diffChangeSchema).optional(),
  truncated: z.literal(true).optional(),
  referencesOnly: z.array(renameSchema).optional(),
});

const nodeDiffSchema = z.object({
  id: z.string(),
  kind: z.enum([...CHANGE_KINDS, 'renamed']),
  type: z.string(),
  typeBefore: z.string().optional(),
  renamedFrom: z.string().optional(),
  fields: z.array(fieldChangeSchema),
  referencesOnly: z.literal(true).optional(),
  beforeIndex: count.optional(),
  afterIndex: count.optional(),
});

const inputsDiffSchema = z.object({
  property: z.string().nullable(),
  kind: z.enum(CHANGE_KINDS),
  required: z.object({ before: z.boolean(), after: z.boolean() }).optional(),
  typeBefore: z.string().optional(),
  typeAfter: z.string().optional(),
  before: z.json().optional(),
  after: z.json().optional(),
  values: z.array(diffChangeSchema),
  truncated: z.literal(true).optional(),
});

const testDiffSchema = z.object({
  name: z.string(),
  kind: z.enum(CHANGE_KINDS),
  fields: z.array(fieldChangeSchema),
  beforeIndex: count.optional(),
  afterIndex: count.optional(),
});

/** What changed between two versions, structurally
 * (`diffAutomationDocuments`). */
export const automationDiffSchema = z.object({
  first: z.boolean(),
  identical: z.boolean(),
  counts: z.object({
    added: count,
    removed: count,
    changed: count,
    renamed: count,
  }),
  nodes: z.array(nodeDiffSchema),
  inputs: z.array(inputsDiffSchema),
  output: fieldChangeSchema.nullable(),
  description: fieldChangeSchema.nullable(),
  tests: z.array(testDiffSchema),
  other: z.array(fieldChangeSchema),
  package: z.array(fieldChangeSchema),
  ignored: z.array(z.literal('ui')),
}) satisfies z.ZodType<AutomationDiff>;

/**
 * The answer of comparing two versions of an automation: the structural
 * diff from `from` to `to` (`from` null when `to` is compared with nothing,
 * as its first version is), and — in the unified format — the patch between
 * the two versions' YAML (`unifiedPatch`), `truncated` when it was cut.
 */
export const versionCompareSchema = automationDiffSchema.extend({
  name: z.string(),
  from: versionNumber.nullable(),
  to: versionNumber,
  unified: z.string().optional(),
  truncated: z.boolean().optional(),
});

// ------------------------------------------------------------- versions

/** A version's latest test check, summed up: how many passed and failed
 * out of how many, which act ran them and who. */
const testsSummarySchema = z.object({
  passed: count,
  failed: count,
  total: count,
  via: z.enum(['save', 'deploy', 'manual']).optional(),
  by: z.string().optional(),
});

/** One version of an automation, as a history lists it. */
export const versionHistoryRowSchema = z.object({
  version: versionNumber,
  message: orNull(z.string()),
  /** Who saved it: a bare user id, `api-key:<userId>` or `system:<what>`. */
  createdBy: z.string(),
  createdAt: z.number(),
  createdVia: writeViaSchema,
  /** `createdVia` was read from `createdBy`, the version being older than
   * the record of doors. */
  viaInferred: z.boolean().default(false),
  /** The name the saving agent's client gave itself. */
  clientName: orNull(z.string()),
  basedOnVersion: orNull(versionNumber),
  restoredFromVersion: orNull(versionNumber),
  changes: orNull(changeSummarySchema),
  testsPassed: orNull(z.boolean()),
  testsCheckedAt: orNull(z.number()),
  tests: orNull(testsSummarySchema),
  deployed: z.boolean().default(false),
  lastDeployedAt: orNull(z.number()),
});

/** A version history: its rows, newest first, which version is live and
 * which is the latest, and where the next page starts (`null` on the
 * last). */
export const versionHistorySchema = z.object({
  versions: z.array(versionHistoryRowSchema),
  deployedVersion: orNull(versionNumber),
  latestVersion: versionNumber.optional(),
  nextBefore: orNull(versionNumber),
});

// ---------------------------------------------------------- deployments

const DEPLOYMENT_KINDS = ['deploy', 'rollback', 'recorded'] as const;

/**
 * One time a version was put live: the version, what was live before it,
 * when, who, through which door and client. `kind` says whether it rolled
 * back to an older version; a door that does not say reads it from the two
 * version numbers.
 */
export const deploymentEntrySchema = z
  .object({
    id: z.string().optional(),
    version: versionNumber,
    previousVersion: orNull(versionNumber),
    kind: z.enum(DEPLOYMENT_KINDS).optional(),
    /** Rebuilt from what is live rather than recorded when it happened. */
    synthesized: z.boolean().default(false),
    deployedAt: z.number(),
    deployedBy: z.string(),
    via: writeViaSchema,
    clientName: orNull(z.string()),
  })
  .transform(({ kind, ...entry }) => ({
    ...entry,
    kind:
      kind ??
      (entry.previousVersion !== null && entry.version < entry.previousVersion
        ? ('rollback' as const)
        : ('deploy' as const)),
  }));

/** What is live now, and since when. */
const liveDeploymentSchema = z.object({
  version: versionNumber,
  deployedAt: z.number(),
  deployedBy: z.string(),
  via: writeViaSchema,
  clientName: orNull(z.string()),
  /** Runs of the live version still going. */
  activeRuns: count,
});

/** An automation's deploys, newest first, and where the next page starts
 * (`null` on the last). */
export const deploymentHistorySchema = z.object({
  live: orNull(liveDeploymentSchema),
  deployments: z.array(deploymentEntrySchema),
  nextBefore: orNull(z.object({ at: z.number(), id: z.string() })),
});
