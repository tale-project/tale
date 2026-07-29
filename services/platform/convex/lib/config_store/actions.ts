'use node';

/**
 * Convex internal IO shim for area-specific config files.
 *
 * The ONLY `'use node'` action file in the file-based-config feature.
 * V8 callers (queries / mutations / V8 actions) cannot read fs directly;
 * they delegate to these internal actions via `ctx.runAction(...)`.
 *
 * Every area resolves through the shared yml-then-json domain-file helper
 * (`read_domain_file.ts`): `<fileBase>.yml` first, `<fileBase>.json` while
 * the org tree is not yet converted to YAML.
 *
 * Future areas (provider, integration, ...) add their internal actions
 * here too, instead of scattering `'use node'` directives across
 * separate files. Keep these thin — no business logic, no auth.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import {
  MAX_FILE_SIZE_BYTES,
  resolveGovernanceDir,
  RETENTION_FILE_BASE,
  validateRetentionData,
} from '../../governance/file_utils';
import { readDomainConfigFile } from './read_domain_file';

/**
 * Per-area file location + validator for the v8-action read strategy. Areas
 * that live at a non-standard path bring their own dir resolver (retention is
 * nested under `governance/`, not at the org root), so this is a small
 * registry rather than a uniform `<org>/<area>` shape.
 */
interface AreaSpec {
  resolveDir: (orgSlug: string) => string;
  fileBase: string;
  validate: (data: unknown) => unknown;
}

const AREAS: Record<string, AreaSpec> = {
  // Retention bounds catalog at `<org>/governance/retention.yml` (nested in
  // the governance flat domain since all org settings became file-based).
  retention: {
    resolveDir: resolveGovernanceDir,
    fileBase: RETENTION_FILE_BASE,
    validate: validateRetentionData,
  },
};

/**
 * Read a single-file config area for an org. Returns the parsed config, or
 * `null` when the file is absent (the caller falls back to defaults). Throws on
 * an unknown area or a corrupt/oversized/symlinked file. New single-file areas
 * register in `AREAS` rather than adding another `'use node'` shim.
 */
export const readConfigArea = internalAction({
  args: { area: v.string(), orgSlug: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (_ctx, args): Promise<unknown> => {
    const spec = AREAS[args.area];
    if (!spec) {
      throw new Error(`Unknown config area: ${args.area}`);
    }
    const result = await readDomainConfigFile(
      spec.resolveDir(args.orgSlug),
      spec.fileBase,
      MAX_FILE_SIZE_BYTES,
      spec.validate,
    );
    if (result.ok) return result.data;
    if (result.error === 'not_found') return null;
    throw new Error(
      `Failed to read config area "${args.area}" for ${args.orgSlug}: ${result.message}`,
    );
  },
});
