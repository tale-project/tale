/**
 * Generates the integration catalog icons from a single canonical source:
 * Iconify's `logos` collection (full-color brand marks).
 *
 * Each integration renders a 24x24 SVG with a baked white rounded tile so dark
 * marks stay visible on both themes; the brand mark is scaled into a ~15px box
 * centered in the tile (matching the existing ~62.5% mark-to-tile ratio). The
 * backend serves these files as `data:image/svg+xml;base64,...` URIs, so they
 * must stay self-contained static SVGs — this script is a build-time tool, not
 * a runtime dependency.
 *
 * Brands absent from the `logos` set (outlook, tavily) are authored by
 * hand and intentionally left untouched here.
 *
 * Run: bun scripts/generate-integration-icons.ts
 */

import { join, resolve } from 'node:path';

import { icons } from '@iconify-json/logos';
import { getIconData } from '@iconify/utils';

const REPO_ROOT = resolve(import.meta.dir, '..');
const INTEGRATIONS_DIR = join(
  REPO_ROOT,
  'configs',
  'platform',
  'system',
  'integrations',
);

/** Tile geometry shared by every integration icon. */
const TILE = 24;
/** Edge of the centered content box; 15/24 ≈ the existing 62.5% ratio. */
const MARK_BOX = 15;

/**
 * Integration slug → Iconify `logos` icon name. Only brands that exist in the
 * set live here; adding a new logos-backed integration is one line + a re-run.
 */
const SLUG_TO_ICON: Record<string, string> = {
  github: 'github-icon',
  slack: 'slack-icon',
  discord: 'discord-icon',
  gmail: 'google-gmail',
  'google-drive': 'google-drive',
  shopify: 'shopify',
  confluence: 'confluence',
  twilio: 'twilio-icon',
  teams: 'microsoft-teams',
};

/** Format a number for SVG output: fixed precision with trailing zeros trimmed. */
function num(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/** Wrap an Iconify icon body in the standard 24x24 white-tile frame. */
function frame(body: string, width: number, height: number): string {
  const scale = MARK_BOX / Math.max(width, height);
  const tx = (TILE - width * scale) / 2;
  const ty = (TILE - height * scale) / 2;
  const transform = `translate(${num(tx)} ${num(ty)}) scale(${num(scale)})`;
  return [
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
    '  <rect width="24" height="24" rx="6" fill="#FFFFFF"/>',
    `  <g transform="${transform}">`,
    `    ${body}`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const slugs = Object.keys(SLUG_TO_ICON).sort();
  for (const slug of slugs) {
    const iconName = SLUG_TO_ICON[slug];
    const data = getIconData(icons, iconName);
    if (!data) {
      throw new Error(
        `Iconify logos set has no icon "${iconName}" (slug ${slug})`,
      );
    }
    const width = data.width ?? icons.width ?? TILE;
    const height = data.height ?? icons.height ?? TILE;
    const svg = frame(data.body, width, height);
    const outPath = join(INTEGRATIONS_DIR, slug, 'icon.svg');
    await Bun.write(outPath, svg);
    console.log(`✓ ${slug} ← logos:${iconName}`);
  }
  console.log(`\nGenerated ${slugs.length} integration icons.`);
}

main();
