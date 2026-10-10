import { stat } from 'node:fs/promises';

import { brandingFormSchema } from '@tale/shared/schemas/branding';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import { resolveImagePath } from '../../core/branding/file_utils.ts';
import {
  identifySingle,
  parseSettingsConfig,
  settingsActor,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import {
  assertBrandingWriter,
  mayChangeBranding,
  readBrandingConfig,
  saveBranding,
} from './service.ts';

/**
 * The organization's branding as a settings kind over MCP (`branding`):
 * one resource — the accent colour and the file names of the logo and the
 * favicons — read and saved through the writer the Branding page uses,
 * behind its owner-or-admin gate, with its compare-and-set and its audit
 * row. The images themselves are uploaded in Tale: a file name a change
 * sets must name an image the organization has uploaded.
 */

const IMAGE_FIELDS = [
  'logoFilename',
  'faviconLightFilename',
  'faviconDarkFilename',
] as const;

/**
 * The branding as the Branding page edits it: a file the old colour field
 * still carries reads with that colour as the accent colour, as every
 * reader shows it, so a read sent back unchanged is the page's own save.
 */
function editedView(config: unknown): Record<string, unknown> {
  if (!isRecord(config)) return {};
  const { brandColor, accentColor, ...rest } = config;
  const colour =
    typeof accentColor === 'string' && accentColor !== ''
      ? accentColor
      : brandColor;
  return {
    ...rest,
    ...(typeof colour === 'string' && colour !== ''
      ? { accentColor: colour }
      : {}),
  };
}

async function readBrandingResource(
  ctx: SettingsContext,
): Promise<SettingsResource | null> {
  assertBrandingWriter(ctx.caller.role);
  const snapshot = await readBrandingConfig(ctx.caller.orgSlug);
  if (snapshot.config === null || snapshot.hash === null) return null;
  return { id: null, config: editedView(snapshot.config), hash: snapshot.hash };
}

/** Whether a file name names an image the organization has uploaded. */
async function uploaded(orgSlug: string, filename: string): Promise<boolean> {
  let file: string;
  try {
    file = resolveImagePath(orgSlug, filename);
  } catch (error) {
    console.warn(
      '[branding] a settings change named an image file name that is not one:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (Reflect.get(Object(error), 'code') === 'ENOENT') return false;
    throw error;
  }
}

export const brandingSettings: SettingsKindHandler = {
  kind: 'branding',
  access: async ({ caller }) => {
    const allowed = mayChangeBranding(caller.role);
    return { read: allowed, write: allowed };
  },
  identify: identifySingle('branding'),
  list: async (ctx) => {
    const current = await readBrandingResource(ctx);
    return { items: current === null ? [] : [current], nextCursor: null };
  },
  read: async (ctx) => readBrandingResource(ctx),
  plan: async (ctx, change, current) => {
    assertBrandingWriter(ctx.caller.role);
    const after = parseSettingsConfig(
      brandingFormSchema,
      change.config,
      'the branding',
    );
    for (const field of IMAGE_FIELDS) {
      const filename = after[field];
      if (filename === undefined || filename === '') continue;
      if (!(await uploaded(ctx.caller.orgSlug, filename))) {
        throw new SettingsRefusalError(
          'BRANDING_IMAGE_UNKNOWN',
          `/config/${field} names no image uploaded to this organization`,
          {
            hint: 'images are uploaded in Tale, under Settings > Branding; a file name here keeps an uploaded one, or is left out to show none',
            data: { field },
          },
        );
      }
    }
    return {
      after,
      unchanged:
        current !== null &&
        configurationHash(after) === configurationHash(current.config),
    };
  },
  apply: async (ctx, change, expectedHash) => {
    const { hash } = await saveBranding(
      ctx.sql,
      ctx.caller.orgSlug,
      change.config,
      expectedHash,
      await settingsActor(ctx),
    );
    return { hash };
  },
};
