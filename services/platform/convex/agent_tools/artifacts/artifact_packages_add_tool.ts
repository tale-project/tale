/**
 * Convex Tool: artifact_packages_add
 *
 * Union package names into a runnable artifact's persistent `runPackages`
 * list so the next `artifact_run` auto-installs them. Idempotent: names
 * already present are skipped. Never removes existing entries —
 * `artifact_create` is the way to start fresh.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import {
  isRunnableArtifactType,
  refinePackagesObject,
  runnableLanguage,
} from './shared';

const artifactPackagesAddArgs = z.object({
  artifactId: z.string().min(1),
  packages: z
    .object({
      python: z
        .array(z.string().min(1).max(120))
        .max(20)
        .optional()
        .describe('Pip specs (e.g. `markitdown[pptx]`).'),
      node: z
        .array(z.string().min(1).max(120))
        .max(20)
        .optional()
        .describe('npm specs (e.g. `pptxgenjs`).'),
    })
    .describe(
      "Per-runtime dependencies to UNION into the artifact's persistent package state. `python` is installed via `uv pip`, `node` via `npm`. At least one bucket must be non-empty. Pinned versions strongly preferred. Examples: `{python: ['markitdown[pptx]']}`, `{node: ['pptxgenjs']}`, `{python: ['numpy'], node: ['lodash']}`. Installs run with `pip --only-binary=:all:` and `npm --ignore-scripts`.",
    )
    .refine((val) => (val.python?.length ?? 0) + (val.node?.length ?? 0) > 0, {
      message: 'packages must include at least one python or node entry',
    })
    .superRefine((val, ctx) => {
      refinePackagesObject(val, (issue) => ctx.addIssue(issue));
    }),
});

type ArtifactPackagesAddInput = z.infer<typeof artifactPackagesAddArgs>;

interface ArtifactPackagesAddSuccess {
  success: true;
  artifactId: string;
  runPackages: string[];
  added: string[];
  runPackagesByLang?: { python?: string[]; node?: string[] };
  addedByLang?: { python?: string[]; node?: string[] };
  message: string;
}

interface ArtifactPackagesAddFailure {
  success: false;
  code?: string;
  message: string;
}

type ArtifactPackagesAddResult =
  | ArtifactPackagesAddSuccess
  | ArtifactPackagesAddFailure;

export const artifactPackagesAddTool = {
  name: 'artifact_packages_add' as const,
  tool: createTool({
    description: `**artifact_packages_add** — declare runtime dependencies for a runnable artifact (\`script_runnable\`, or legacy \`python_runnable\` / \`node_runnable\`). Union the per-runtime specs into the artifact's persistent package state so the next \`artifact_run\` auto-installs them.

**WHEN TO CALL:** right after \`artifact_file_create\` / \`artifact_file_update\` introduces a new \`import\`/\`require\` for an external dependency, before \`artifact_run\`.

**INPUTS:**
- \`artifactId\` — required.
- \`packages\` — required, **grouped object** \`{python?: string[], node?: string[]}\`. At least one bucket must contain at least one spec. \`python\` is installed via \`uv pip\`, \`node\` via \`npm\`. Pinned versions strongly preferred (e.g. \`"requests==2.31.0"\`, \`"pptxgenjs@3.12.0"\`).

\`\`\`json
// Python-only artifact:
{ "artifactId": "...", "packages": { "python": ["markitdown[pptx]"] } }

// Node-only artifact:
{ "artifactId": "...", "packages": { "node": ["pptxgenjs"] } }

// Mixed (script_runnable):
{ "artifactId": "...", "packages": { "python": ["markitdown[pptx]"], "node": ["pptxgenjs"] } }
\`\`\`

**IDEMPOTENT:** existing entries are never removed; specs already present are silently skipped. To start fresh, create a new artifact via \`artifact_create\` with the desired \`packages\`.

**REFUSED ON** non-runnable artifact types (code: \`not_runnable\`).

**RESPONSE:** \`{runPackages, added, runPackagesByLang?, addedByLang?, message}\`. \`added\` / \`addedByLang\` list only the specs that were new.`,
    inputSchema: artifactPackagesAddArgs,
    execute: async (
      ctx: ToolCtx,
      args: ArtifactPackagesAddInput,
      _options: ToolExecutionOptions,
    ): Promise<ArtifactPackagesAddResult> => {
      const { organizationId, threadId } = ctx;
      if (!organizationId || !threadId) {
        return {
          success: false,
          message:
            'artifact_packages_add requires organizationId and threadId in the tool context.',
        };
      }
      let artifactId;
      try {
        artifactId = toId<'artifacts'>(args.artifactId);
      } catch (err) {
        return {
          success: false,
          message: `Artifact id "${args.artifactId}" is malformed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const artifact = await ctx.runQuery(
        internal.artifacts.internal_queries.getById,
        {
          artifactId,
          expectedOrganizationId: organizationId,
          expectedThreadId: threadId,
        },
      );
      if (!artifact) {
        return {
          success: false,
          code: 'not_found',
          message: `Artifact ${args.artifactId} not found in this thread.`,
        };
      }
      if (!isRunnableArtifactType(artifact.type)) {
        return {
          success: false,
          code: 'not_runnable',
          message: `Artifact "${artifact.title}" is of type "${artifact.type}", which does not run packages. Only script_runnable (or legacy python_runnable / node_runnable) types support runPackages.`,
        };
      }
      // Grouped buckets only — Zod's `refine` upstream already ensures
      // at least one is non-empty. Mirror the locked-runtime bucket to
      // the legacy flat `runPackages` field so single-runtime readers
      // (audit row preview, canvas display) keep matching. Polyglot
      // (`script_runnable`) has no locked runtime, so the legacy mirror
      // uses python by convention.
      const locked = runnableLanguage(artifact.type);
      const py = args.packages.python ?? [];
      const node = args.packages.node ?? [];
      const packagesAddByLang: { python?: string[]; node?: string[] } = {
        ...(py.length > 0 && { python: py }),
        ...(node.length > 0 && { node }),
      };
      const packagesAddFlat = locked === 'node' ? node : py;
      const result = await ctx.runMutation(
        internal.artifacts.internal_mutations.addArtifactPackages,
        {
          artifactId,
          packagesAdd: packagesAddFlat,
          ...(Object.keys(packagesAddByLang).length > 0 && {
            packagesAddByLang,
          }),
        },
      );
      const totalAdded =
        result.added.length +
        (result.addedByLang?.python?.length ?? 0) +
        (result.addedByLang?.node?.length ?? 0);
      const addedNote =
        totalAdded === 0
          ? 'No new packages added (all were already present).'
          : `Added ${totalAdded} package${totalAdded === 1 ? '' : 's'} (flat: ${result.added.join(', ') || '<none>'}; python: ${result.addedByLang?.python?.join(', ') ?? '<none>'}; node: ${result.addedByLang?.node?.join(', ') ?? '<none>'}).`;
      return {
        success: true,
        artifactId: args.artifactId,
        runPackages: result.runPackages,
        added: result.added,
        ...(result.runPackagesByLang !== undefined && {
          runPackagesByLang: result.runPackagesByLang,
        }),
        ...(result.addedByLang !== undefined && {
          addedByLang: result.addedByLang,
        }),
        message: `${addedNote} Current runPackages (${result.runPackages.length}): ${result.runPackages.join(', ') || '<empty>'}.`,
      };
    },
  }),
} as const satisfies ToolDefinition;
