'use node';

/**
 * App discovery for the Apps hub. Reads `apps/<slug>/app.json` manifests and
 * each app's bundled `views/*.json` (the configurable pages). Fully data-driven
 * — a new app dir appears in the hub with no code change. Malformed manifests /
 * views are skipped (never fail the whole list).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import {
  appManifestSchema,
  isValidAppSlug,
} from '../../lib/shared/schemas/apps';
import { viewConfigSchema } from '../../lib/shared/schemas/views';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { errnoCode } from '../lib/file_io';
import {
  resolveAppDir,
  resolveAppManifestPath,
  resolveAppsDir,
} from './file_utils';

const MAX_VIEW_BYTES = 256 * 1024;

export const listApps = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous app/view shapes at the API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const appsDir = resolveAppsDir(orgSlug);
    let slugs: string[];
    try {
      const entries = await readdir(appsDir, { withFileTypes: true });
      slugs = entries
        .filter((e) => e.isDirectory() && isValidAppSlug(e.name))
        .map((e) => e.name);
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return [];
      throw err;
    }

    const apps: Array<Record<string, unknown>> = [];
    for (const slug of slugs.sort()) {
      let manifest;
      try {
        const content = await readFile(
          resolveAppManifestPath(orgSlug, slug),
          'utf8',
        );
        manifest = appManifestSchema.parse(JSON.parse(content));
      } catch (err) {
        console.warn(`[listApps] skipping app "${slug}":`, err);
        continue;
      }

      const views: unknown[] = [];
      const viewsDir = path.join(resolveAppDir(orgSlug, slug), 'views');
      let viewFiles: string[] = [];
      try {
        viewFiles = (await readdir(viewsDir)).filter((f) =>
          f.endsWith('.json'),
        );
      } catch {
        // No views dir — an app can ship workflows/agents without UI pages.
      }
      for (const file of viewFiles.sort()) {
        const filePath = path.join(viewsDir, file);
        try {
          const info = await stat(filePath);
          if (info.size > MAX_VIEW_BYTES) {
            console.warn(`[listApps] view too large, skipping: ${filePath}`);
            continue;
          }
          const parsed = viewConfigSchema.safeParse(
            JSON.parse(await readFile(filePath, 'utf8')),
          );
          if (parsed.success) views.push(parsed.data);
          else
            console.warn(
              `[listApps] invalid view ${file}:`,
              parsed.error.message,
            );
        } catch (err) {
          console.warn(`[listApps] view read failed ${file}:`, err);
        }
      }

      apps.push({
        slug,
        name: manifest.name,
        description: manifest.description ?? '',
        ...(manifest.icon !== undefined && { icon: manifest.icon }),
        ...(manifest.messageNamespace !== undefined && {
          messageNamespace: manifest.messageNamespace,
        }),
        workflows: manifest.workflows ?? [],
        agents: manifest.agents ?? [],
        views,
      });
    }

    return apps;
  },
});
