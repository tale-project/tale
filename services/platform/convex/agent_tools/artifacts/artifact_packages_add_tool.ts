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
  classifyPackages,
  isRunnableArtifactType,
  runnableLanguage,
} from './shared';

const artifactPackagesAddArgs = z.object({
  artifactId: z.string().min(1),
  packages: z
    .union([
      z.array(z.string().min(1).max(120)).min(1).max(20),
      z.object({
        python: z.array(z.string().min(1).max(120)).max(20).optional(),
        node: z.array(z.string().min(1).max(120)).max(20).optional(),
      }),
    ])
    .describe(
      "Pip/npm specs to UNION into the artifact's persistent package state. Pass a flat array (legacy single-runtime form: routed to the artifact's existing language) OR a grouped object `{python?: string[], node?: string[]}` to declare per-runtime deps for a `script_runnable` artifact. Pinned versions strongly preferred. Installs always run with `pip --only-binary=:all:` and `npm --ignore-scripts`.",
    ),
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
    description: `**artifact_packages_add** — declare runtime dependencies for a runnable artifact (\`script_runnable\`, or legacy \`python_runnable\` / \`node_runnable\`). Union the given names into the artifact's persistent package state so the next \`artifact_run\` auto-installs them. Pass a flat array for single-runtime artifacts; pass \`{python?, node?}\` for a \`script_runnable\` that mixes languages.

**WHEN TO CALL:** right after \`artifact_file_create\` / \`artifact_file_update\` introduces a new \`import\`/\`require\` for an external dependency, before \`artifact_run\`.

**INPUTS:**
- \`artifactId\` — required.
- \`packages\` — required, 1–20 specs. Pinned versions strongly preferred (e.g. \`"requests==2.31.0"\` not just \`"requests"\`).

**IDEMPOTENT:** existing entries are never removed; specs already present are silently skipped. To start fresh, create a new artifact via \`artifact_create\` with the desired \`packages\` list.

**REFUSED ON** non-runnable artifact types (code: \`not_runnable\`).

**RESPONSE:** \`{runPackages, added, message}\`. \`added\` lists only the specs that were new.`,
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
      // Split the input into the two shapes the mutation accepts.
      //
      // For grouped input: pass through verbatim — agent already
      // declared which bucket each spec belongs to.
      //
      // For flat input: classify via `classifyPackages` so a `python:`
      // / `node:` / `pip:` / `npm:` prefix routes the spec to the
      // matching bucket (stripped); bare specs fall back to the
      // artifact's locked runtime (for legacy `python_runnable` /
      // `node_runnable`) or python (for `script_runnable` polyglot
      // artifacts — the prefix convention is the only signal we have).
      // We forward the per-language buckets via `packagesAddByLang`;
      // `packagesAdd` (legacy flat) gets ONLY the bucket that matches
      // the artifact's locked runtime, so single-runtime readers keep
      // working unchanged.
      const locked = runnableLanguage(artifact.type);
      let packagesAddFlat: string[] = [];
      let packagesAddByLang: { python?: string[]; node?: string[] } | undefined;
      if (Array.isArray(args.packages)) {
        const classified = classifyPackages(args.packages, locked ?? 'python');
        if (classified.python.length > 0 || classified.node.length > 0) {
          packagesAddByLang = {
            ...(classified.python.length > 0 && {
              python: classified.python,
            }),
            ...(classified.node.length > 0 && { node: classified.node }),
          };
        }
        // Mirror the locked-runtime bucket to the legacy flat field so
        // `runPackages` keeps matching what single-language readers
        // expect. For polyglot rows there's no single "right" choice —
        // python wins by convention (same as classifyPackages default).
        packagesAddFlat =
          locked === 'node' ? classified.node : classified.python;
      } else {
        packagesAddByLang = args.packages;
        // Grouped input: mirror the runtime-matching bucket as above.
        const py = args.packages.python ?? [];
        const node = args.packages.node ?? [];
        packagesAddFlat = locked === 'node' ? node : py;
      }
      const result = await ctx.runMutation(
        internal.artifacts.internal_mutations.addArtifactPackages,
        {
          artifactId,
          packagesAdd: packagesAddFlat,
          ...(packagesAddByLang !== undefined && { packagesAddByLang }),
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
