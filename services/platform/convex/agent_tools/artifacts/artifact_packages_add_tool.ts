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
import { isRunnableArtifactType } from './shared';

const artifactPackagesAddArgs = z.object({
  artifactId: z.string().min(1),
  packages: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(20)
    .describe(
      "Pip/npm specs to UNION into the artifact's persistent `runPackages`. Pinned versions strongly preferred. Installs always run with `pip --only-binary=:all:` and `npm --ignore-scripts`.",
    ),
});

type ArtifactPackagesAddInput = z.infer<typeof artifactPackagesAddArgs>;

interface ArtifactPackagesAddSuccess {
  success: true;
  artifactId: string;
  runPackages: string[];
  added: string[];
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
    description: `**artifact_packages_add** — declare runtime dependencies for a runnable artifact (\`python_runnable\` / \`node_runnable\`). Union the given names into the artifact's persistent \`runPackages\` so the next \`artifact_run\` auto-installs them.

**WHEN TO CALL:** right after \`file_create\` / \`file_update\` introduces a new \`import\`/\`require\` for an external dependency, before \`artifact_run\`.

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
          message: `Artifact "${artifact.title}" is of type "${artifact.type}", which does not run packages. Only python_runnable / node_runnable types support runPackages.`,
        };
      }
      const result = await ctx.runMutation(
        internal.artifacts.internal_mutations.addArtifactPackages,
        { artifactId, packagesAdd: args.packages },
      );
      const addedNote =
        result.added.length === 0
          ? 'No new packages added (all were already present).'
          : `Added ${result.added.length} package${result.added.length === 1 ? '' : 's'}: ${result.added.join(', ')}.`;
      return {
        success: true,
        artifactId: args.artifactId,
        runPackages: result.runPackages,
        added: result.added,
        message: `${addedNote} Current runPackages (${result.runPackages.length}): ${result.runPackages.join(', ') || '<empty>'}.`,
      };
    },
  }),
} as const satisfies ToolDefinition;
