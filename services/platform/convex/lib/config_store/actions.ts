'use node';

/**
 * Convex internal IO shim for area-specific JSON config files.
 *
 * The ONLY `'use node'` action file in the file-based-config feature.
 * V8 callers (queries / mutations / V8 actions) cannot read fs directly;
 * they delegate to these internal actions via `ctx.runAction(...)`.
 *
 * Future areas (provider, integration, ...) add their internal actions
 * here too, instead of scattering `'use node'` directives across
 * separate files. Keep these thin — no business logic, no auth.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import {
  MAX_FILE_SIZE_BYTES,
  parseRetentionJson,
  resolveRetentionFilePath,
} from '../../governance/file_utils';
import { readJsonFile } from '../file_io';

/**
 * Per-area file resolver + parser for the v8-action read strategy. Areas that
 * live at a non-standard path bring their own resolver (retention is nested
 * under `governance/`, not at the org root), so this is a small registry rather
 * than the uniform `createFileConfigStore` `<org>/<area>.json` shape.
 */
interface AreaSpec {
  resolveFilePath: (orgSlug: string) => string;
  parse: (content: string) => unknown;
}

const AREAS: Record<string, AreaSpec> = {
  // Retention bounds catalog at `<org>/governance/retention.json` (nested in
  // the governance flat domain since all org settings became file-based).
  retention: {
    resolveFilePath: resolveRetentionFilePath,
    parse: parseRetentionJson,
  },
};

/**
 * Read a single-file config area for an org. Returns the parsed config, or
 * `null` when the file is absent (the caller falls back to defaults). Throws on
 * an unknown area or a corrupt/oversized/symlinked file.
 *
 * Generalizes the former `readRetentionConfig` — new single-file areas register
 * in `AREAS` instead of adding another `'use node'` shim.
 */
export const readConfigArea = internalAction({
  args: { area: v.string(), orgSlug: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (_ctx, args): Promise<unknown> => {
    const spec = AREAS[args.area];
    if (!spec) {
      throw new Error(`Unknown config area: ${args.area}`);
    }
    const filePath = spec.resolveFilePath(args.orgSlug);
    const result = await readJsonFile(
      filePath,
      MAX_FILE_SIZE_BYTES,
      spec.parse,
    );
    if (result.ok) return result.data;
    if (result.error === 'not_found') return null;
    throw new Error(
      `Failed to read config area "${args.area}" for ${args.orgSlug}: ${result.message}`,
    );
  },
});
