'use node';

/**
 * Corporate-identity (branding) context for presentation generation.
 *
 * The platform can generate presentations (PPTX) from a prompt, a website, or
 * an uploaded document via the `assistant` agent + bundled `pptx` skill. By
 * default those decks are styled generically — the org's configured branding
 * (brand color, accent color, logo) has no effect on the output.
 *
 * This module bridges that gap: when an agent has the `pptx` skill bound and
 * the org has branding configured, it builds a system-prompt section that
 * teaches the model to apply the org's corporate identity as the DEFAULT theme
 * for generated/edited decks — while still honoring explicit per-request
 * overrides. Because every generation path (prompt / website / document) runs
 * through the same agent chat turn, wiring this once covers all three.
 *
 * Branding is read straight off disk (same source as
 * {@link readBranding}) rather than through a `runAction` hop, so it composes
 * into the tool-build `Promise.all` in `internal_actions.ts` without an extra
 * round-trip. A missing / corrupt / empty branding file degrades to an empty
 * section — branding is an enhancement layer and must never abort a chat turn.
 */

import {
  buildBrandingImageUrl,
  MAX_FILE_SIZE_BYTES,
  parseBrandingJson,
  resolveBrandingFilePath,
  type BrandingJsonConfig,
} from '../../branding/file_utils';
import { readJsonFile } from '../../lib/file_io';

/**
 * Slug of the bundled presentation skill. Branding context is only injected for
 * agents that actually bind this skill — a deck-less agent gets no extra prompt
 * weight. Mirrors `skillBindings: ["pptx"]` on the default `assistant` agent.
 */
export const PPTX_SKILL_SLUG = 'pptx';

/** Whether the agent's skill allowlist includes the presentation skill. */
export function agentHasPptxSkill(
  boundSlugs: readonly string[] | undefined,
): boolean {
  return Array.isArray(boundSlugs) && boundSlugs.includes(PPTX_SKILL_SLUG);
}

/**
 * Read and parse the org's `branding.json`. Returns `null` for any non-success
 * outcome (not found, corrupt, too large, symlink, inaccessible) so callers can
 * treat "no usable branding" uniformly. Never throws.
 */
export async function readOrgBrandingConfig(
  orgSlug: string,
): Promise<BrandingJsonConfig | null> {
  let filePath: string;
  try {
    filePath = resolveBrandingFilePath(orgSlug);
  } catch {
    // Invalid org slug — branding is optional, so degrade silently.
    return null;
  }

  const result = await readJsonFile<BrandingJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseBrandingJson,
  );
  if (result.ok) return result.data;
  if (result.error !== 'not_found') {
    console.warn(
      `[branding_context] Failed to read branding for "${orgSlug}": ${result.message}`,
    );
  }
  return null;
}

/** Non-empty hex color (the schema permits `''` to mean "unset"). */
function presentColor(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Build the corporate-identity system-prompt section from a branding config.
 *
 * Pure and deterministic (the only impure input, the logo URL, is derived from
 * `process.env.SITE_URL`/`BASE_PATH` via {@link buildBrandingImageUrl}, the same
 * way the rest of the app resolves branding image URLs). Returns `''` when no
 * usable branding field is set, so the caller can append unconditionally.
 *
 * The section is operator-authored data, not a user instruction — colors are
 * validated hex and the logo URL is a same-origin path, so there's nothing to
 * escape, but the prompt frames it as defaults the user may override.
 */
export function buildBrandingPromptSection(
  orgSlug: string,
  config: BrandingJsonConfig | null,
): string {
  if (!config) return '';

  const brandColor = presentColor(config.brandColor);
  const accentColor = presentColor(config.accentColor);
  const logoUrl = buildBrandingImageUrl(orgSlug, config.logoFilename);

  if (!brandColor && !accentColor && !logoUrl) return '';

  const lines: string[] = [
    '',
    '## Corporate Identity (Presentation Branding)',
    '',
    "When you generate, design, or edit a presentation (the `pptx` skill), apply this organization's configured corporate identity as the DEFAULT theme. These brand values REPLACE the generic sample palettes in the pptx skill — do not fall back to the example color palettes when a brand color is set below.",
    '',
  ];

  if (brandColor) {
    lines.push(
      `- **Brand color**: \`${brandColor}\` — the dominant color (60–70% visual weight): titles, section headers, key accents, and dark title/closing slide backgrounds.`,
    );
  }
  if (accentColor) {
    lines.push(
      `- **Accent color**: \`${accentColor}\` — the supporting/highlight color: callouts, stat numbers, icons, and small emphasis elements.`,
    );
  }
  if (logoUrl) {
    lines.push(
      `- **Logo**: ${logoUrl} — download it into the sandbox (e.g. with \`curl\`/\`fetch\`) and place it on the title slide and, kept small and unobtrusive, in a corner of content slides. Skip it gracefully if the download fails.`,
    );
  }

  lines.push(
    '',
    'Keep the pptx skill\'s other design guidance (layout variety, contrast, typography, spacing). The user may override any of these per request (e.g. "use a dark green theme" or "no logo") — always honor explicit user instructions over these branding defaults.',
    '',
  );

  return lines.join('\n') + '\n';
}

/**
 * End-to-end helper: if the agent binds the pptx skill, read the org's branding
 * and return the prompt section; otherwise (or on any failure) return `''`.
 * Safe to `await` inside the tool-build `Promise.all` — never throws.
 */
export async function buildBrandingContext(
  orgSlug: string,
  boundSlugs: readonly string[] | undefined,
): Promise<string> {
  if (!agentHasPptxSkill(boundSlugs)) return '';
  try {
    const config = await readOrgBrandingConfig(orgSlug);
    return buildBrandingPromptSection(orgSlug, config);
  } catch (err) {
    console.warn(
      '[branding_context] buildBrandingContext failed; proceeding without branding:',
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}
