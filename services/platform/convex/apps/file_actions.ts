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
  appScope,
  isValidAppSlug,
} from '../../lib/shared/schemas/apps';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { errnoCode } from '../lib/file_io';
import {
  resolveAppDir,
  resolveAppManifestPath,
  resolveAppsDir,
} from './file_utils';

const MAX_VIEW_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
          // A view wraps id/title/description over either a flat Puck Data
          // document (`data`) or a tabbed shell (`tabs`).
          const raw: unknown = JSON.parse(await readFile(filePath, 'utf8'));
          if (
            isRecord(raw) &&
            (isRecord(raw.data) || Array.isArray(raw.tabs))
          ) {
            views.push({
              id:
                typeof raw.id === 'string'
                  ? raw.id
                  : file.replace(/\.json$/, ''),
              ...(typeof raw.title === 'string' && { title: raw.title }),
              ...(typeof raw.description === 'string' && {
                description: raw.description,
              }),
              ...(isRecord(raw.data) && { data: raw.data }),
              ...(Array.isArray(raw.tabs) && { tabs: raw.tabs }),
            });
          } else {
            console.warn(
              `[listApps] view ${file} has no Puck \`data\`/\`tabs\`; skipping`,
            );
          }
        } catch (err) {
          console.warn(`[listApps] view read failed ${file}:`, err);
        }
      }

      // The app's own label catalog (pack-authored): messages/<locale>.json,
      // each a flat { labelKey: string } map. Delivered with the app so the
      // client can resolve `ui.labelKey` (friendly step names etc.) by direct
      // lookup — without a per-label server round-trip.
      const messages: Record<string, Record<string, string>> = {};
      const messagesDir = path.join(resolveAppDir(orgSlug, slug), 'messages');
      let messageFiles: string[] = [];
      try {
        messageFiles = (await readdir(messagesDir)).filter((f) =>
          f.endsWith('.json'),
        );
      } catch {
        // No messages dir — app ships no own labels; labelKeys fall back.
      }
      for (const file of messageFiles) {
        const filePath = path.join(messagesDir, file);
        try {
          const info = await stat(filePath);
          if (info.size > MAX_VIEW_BYTES) {
            console.warn(
              `[listApps] messages too large, skipping: ${filePath}`,
            );
            continue;
          }
          const raw: unknown = JSON.parse(await readFile(filePath, 'utf8'));
          if (isRecord(raw)) {
            const flat: Record<string, string> = {};
            for (const [k, val] of Object.entries(raw)) {
              if (typeof val === 'string') flat[k] = val;
            }
            messages[file.replace(/\.json$/, '')] = flat;
          }
        } catch (err) {
          console.warn(`[listApps] messages read failed ${file}:`, err);
        }
      }

      apps.push({
        slug,
        name: manifest.name,
        description: manifest.description ?? '',
        scope: appScope(manifest),
        ...(manifest.icon !== undefined && { icon: manifest.icon }),
        ...(manifest.messageNamespace !== undefined && {
          messageNamespace: manifest.messageNamespace,
        }),
        workflows: manifest.workflows ?? [],
        agents: manifest.agents ?? [],
        functions: manifest.capabilities?.functions ?? [],
        // Declared integration dependencies — lets the hub know, before install,
        // whether to route through the connect wizard. Pure projection of the
        // already-parsed manifest; the same list is denormalized onto the
        // install record (`appInstallations.requiredIntegrations`).
        requiredIntegrations: manifest.requires?.integrations ?? [],
        // Declared per-install config keys (e.g. github owner/repo). Drives the
        // app's config form; values are stored on the install row + read by
        // views via `$config:`.
        requiredConfig: manifest.requires?.config ?? [],
        views,
        ...(Object.keys(messages).length > 0 && { messages }),
      });
    }

    return apps;
  },
});
