import { readFileSync } from 'node:fs';
import path from 'node:path';

import { releaseIdentity, sha256, skillBindings, stableJson } from './identity';
import {
  insist,
  manifestSchema,
  type ClientAutomation,
  type LoadedRelease,
  type Manifest,
  type Artifact,
} from './model';

export function validateManifest(
  value: unknown,
  context: ClientAutomation,
  manifestBytes?: Uint8Array,
): Manifest {
  const manifest = manifestSchema.parse(value);
  const identity = releaseIdentity(manifest);
  const { client, automation } = context;
  insist(
    manifest.automationName === automation.name &&
      manifest.displayName === automation.displayName,
    'unexpected automation identity',
  );
  const historical = automation.historicalReleases.find(
    (item) => item.version === identity,
  );
  const compiled = manifest.schemaVersion !== 1;
  if (manifest.schemaVersion >= 3) {
    insist(
      !historical &&
        manifest.compilerVersion === (manifest.schemaVersion === 4 ? 3 : 2),
      'unsupported release compiler/provenance',
    );
    insist(
      manifest.clientId === client.clientId &&
        manifest.sourceRepository === client.sourceRepository &&
        manifest.descriptorPath &&
        manifest.descriptorSha256,
      'release descriptor provenance missing or different',
    );
    const descriptorDirectory = path.posix.dirname(manifest.descriptorPath);
    insist(
      manifest.packPath ===
        path.posix.join(descriptorDirectory, automation.packPath),
      'release pack path differs from descriptor',
    );
  } else {
    insist(
      historical &&
        manifestBytes &&
        sha256(manifestBytes) === historical.manifestSha256,
      'historical release must match an explicitly retained manifest',
    );
    insist(
      manifest.packPath === historical.packPath,
      'historical source path differs',
    );
    insist(
      manifest.clientId === undefined &&
        manifest.sourceRepository === undefined &&
        manifest.descriptorPath === undefined &&
        manifest.descriptorSha256 === undefined,
      'historic provenance must not be reassigned',
    );
  }
  const expectedBindings = skillBindings(
    automation.logicalSkillSlugs,
    identity,
  );
  const expectedSlugs = compiled
    ? expectedBindings.map((item) => item.releaseSlug)
    : automation.logicalSkillSlugs;
  insist(
    stableJson([...manifest.skillSlugs].sort()) ===
      stableJson([...expectedSlugs].sort()),
    'unexpected carried skills',
  );
  insist(
    manifest.artifact.path === `${identity}/${automation.name}.zip`,
    'unexpected canonical artifact path',
  );
  if (compiled) {
    insist(
      manifest.compilerVersion ===
        (manifest.schemaVersion === 2
          ? 1
          : manifest.schemaVersion === 3
            ? 2
            : 3) &&
        (expectedSlugs.length === 0 || manifest.skillOwnerUserId) &&
        manifest.presentationSha256 &&
        manifest.taskContractSha256 &&
        manifest.installArtifacts,
      'compiled release metadata missing',
    );
    insist(
      stableJson(manifest.skillBindings) === stableJson(expectedBindings),
      'invalid immutable skill bindings',
    );
    insist(
      stableJson(manifest.requiredExternalSkills) ===
        stableJson(automation.requiredExternalSkills),
      'unexpected external skill dependencies',
    );
    insist(
      manifest.installArtifacts.workflow.path ===
        `${identity}/${automation.name}.workflow.zip`,
      'invalid workflow installation path',
    );
    insist(
      manifest.installArtifacts.skills.length === expectedSlugs.length,
      'skill installation inventory differs',
    );
    for (const [index, expectedSlug] of expectedSlugs.entries()) {
      const artifact = manifest.installArtifacts.skills[index];
      const suffix =
        manifest.schemaVersion === 2 ? 'skill' : `${expectedSlug}.skill`;
      insist(
        artifact?.slug === expectedSlug &&
          artifact.path === `${identity}/${automation.name}.${suffix}.zip`,
        'invalid skill installation binding',
      );
    }
  } else {
    insist(
      manifest.compilerVersion === undefined &&
        manifest.skillOwnerUserId === undefined &&
        manifest.skillBindings === undefined &&
        manifest.installArtifacts === undefined &&
        manifest.requiredExternalSkills === undefined,
      'legacy release cannot claim compiled bindings',
    );
  }
  const seen = new Set<string>();
  for (const file of manifest.skillFiles) {
    insist(
      expectedSlugs.includes(file.slug) &&
        !file.path.split('/').some((part) => part.startsWith('.')),
      'invalid skill file identity',
    );
    const key = `${file.slug}/${file.path}`;
    insist(!seen.has(key), 'duplicate skill file path');
    seen.add(key);
  }
  insist(
    expectedSlugs.every((item) => seen.has(`${item}/SKILL.md`)),
    'release omits required skill entry',
  );
  return manifest;
}
export function loadRelease(
  manifestPath: string,
  context: ClientAutomation,
): LoadedRelease {
  const source = readFileSync(manifestPath);
  const manifest = validateManifest(
    JSON.parse(source.toString('utf8')),
    context,
    source,
  );
  const load = (artifact: Artifact) => {
    const artifactPath = path.join(path.dirname(manifestPath), artifact.path);
    const bytes = readFileSync(artifactPath);
    insist(
      bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256,
      'release artifact checksum/size mismatch',
    );
    return { artifactPath, bytes };
  };
  return {
    manifest,
    ...load(manifest.artifact),
    historical: context.automation.historicalReleases.find(
      (item) => item.version === manifest.version,
    ),
    ...(manifest.installArtifacts
      ? {
          installation: {
            workflow: load(manifest.installArtifacts.workflow),
            skills: manifest.installArtifacts.skills.map((artifact) =>
              Object.assign({ slug: artifact.slug }, load(artifact)),
            ),
          },
        }
      : {}),
  };
}
