import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MAX_SKILL_SLUG_LENGTH } from '../../../../../../services/platform/lib/shared/schemas/skills';
import {
  clientSchema,
  insist,
  relativePath,
  version,
  slug,
  gitSha,
  type ClientAutomation,
  type Manifest,
  type SkillBinding,
} from './model';

export const sha256 = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  const json = JSON.stringify(value);
  insist(json !== undefined, 'value is not JSON serializable');
  return json;
}
export const valueHash = (value: unknown): string => sha256(stableJson(value));
function releaseSkillSlug(logicalSlug: string, releaseVersion: string): string {
  if (gitSha.safeParse(releaseVersion).success) {
    const suffix = `-g-${releaseVersion}`;
    // Preserve every commit digit. Only the readable logical prefix can be
    // shortened; skillBindings refuses collisions before any bytes are published.
    const prefix = slug
      .parse(logicalSlug)
      .slice(0, MAX_SKILL_SLUG_LENGTH - suffix.length)
      .replace(/-+$/, '');
    return slug.parse(`${prefix}${suffix}`);
  }
  return slug.parse(
    `${slug.parse(logicalSlug)}-v${version.parse(releaseVersion).replaceAll('.', '-')}`,
  );
}
export const skillBindings = (
  logical: string[],
  releaseVersion: string,
): SkillBinding[] => {
  const result = logical.map((logicalSlug) => ({
    logicalSlug,
    releaseSlug: releaseSkillSlug(logicalSlug, releaseVersion),
  }));
  insist(
    new Set(result.map((item) => item.releaseSlug)).size === result.length,
    'immutable skill slug collision after logical prefix shortening',
  );
  return result;
};
/** Native integer versions and optional legacy labels are not source identity. */
export function releaseIdentity(manifest: Manifest): string {
  const identity =
    manifest.schemaVersion === 4 ? manifest.releaseRef : manifest.version;
  insist(identity, 'release identity missing');
  return identity;
}
export function parseClient(
  bytes: string,
  descriptorPath: string,
  automationName: string,
): ClientAutomation {
  const client = clientSchema.parse(JSON.parse(bytes));
  const automation = client.automations.find(
    (item) => item.name === automationName,
  );
  insist(automation, 'automation is not declared by this client');
  return { client, automation, descriptorPath: path.resolve(descriptorPath) };
}
export const loadClient = (
  descriptorPath: string,
  automationName: string,
): ClientAutomation =>
  parseClient(
    readFileSync(descriptorPath, 'utf8'),
    descriptorPath,
    automationName,
  );
export function repoPath(repoRoot: string, absolute: string): string {
  return relativePath.parse(
    path
      .relative(path.resolve(repoRoot), path.resolve(absolute))
      .split(path.sep)
      .join('/'),
  );
}
export function sourcePackPath(
  repoRoot: string,
  context: ClientAutomation,
): string {
  return repoPath(
    repoRoot,
    path.resolve(
      path.dirname(context.descriptorPath),
      context.automation.packPath,
    ),
  );
}
