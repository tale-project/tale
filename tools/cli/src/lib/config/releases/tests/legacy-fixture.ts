import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { archive, unpack, excludedNativePath } from '../archive';
import { presentationOf } from '../compiler';
import { committedEntries, treeHash } from '../git';
import { loadClient, sha256, valueHash, skillBindings } from '../identity';
import { rebuildHistorical } from '../legacy';
import { loadRelease } from '../manifest';
import type { Manifest } from '../model';
import { legacyGitArchive } from '../snapshot';
import { fixture } from './fixture';

/** Historical transport fixture built from an unrelated committed client, so
 * shared-tool tests neither own VAT content nor require its private repository. */
export async function historicalFixture(
  schemaVersion: 1 | 2 = 1,
  eligible = true,
) {
  const f = fixture('legacy', ['invoice'], []);
  const context = loadClient(f.descriptorPath, f.name);
  const packPath = `tale/clients/legacy/${context.automation.packPath}`;
  const entries = committedEntries(f.root, f.options.sourceCommit, packPath);
  const packTree = treeHash(f.root, f.options.sourceCommit, packPath);
  const version = schemaVersion === 1 ? '1.0.3' : '1.0.4';
  const slug =
    schemaVersion === 1
      ? 'invoice'
      : `invoice-v${version.replaceAll('.', '-')}`;
  let canonical = legacyGitArchive(entries, f.name, packTree);
  let companions;
  const skeleton = {
    schemaVersion,
    compilerVersion: 1,
    automationName: f.name,
    packTree,
    skillBindings: skillBindings(['invoice'], version),
    skillOwnerUserId: 'native_owner_test',
  } as Manifest;
  if (schemaVersion === 2) {
    companions = rebuildHistorical(entries, skeleton, context);
    canonical = companions.canonical;
  }
  const bytes = await unpack(canonical);
  const source = (name: string) =>
    bytes.find((entry) => entry.path === `${f.name}/${name}`)!.bytes;
  const metadata = parse(source('automation.yml').toString());
  const manifest: Manifest = {
    schemaVersion,
    version,
    sourceCommit: f.options.sourceCommit,
    packPath,
    packTree,
    automationName: f.name,
    displayName: context.automation.displayName,
    artifact: {
      path: `${version}/${f.name}.zip`,
      sha256: sha256(canonical),
      bytes: canonical.length,
    },
    documentSha256: valueHash(parse(source('workflow.yml').toString())),
    settingsSha256: valueHash(metadata.settings ?? null),
    skillSlugs: [slug],
    skillFiles: bytes
      .filter(
        (entry) =>
          entry.path.startsWith(`${f.name}/skills/`) &&
          !excludedNativePath(entry.path),
      )
      .map((entry) => ({
        slug,
        path: entry.path.slice(`${f.name}/skills/${slug}/`.length),
        bytes: entry.bytes.length,
        sha256: sha256(entry.bytes),
      })),
    ...(schemaVersion === 2
      ? {
          compilerVersion: 1,
          skillOwnerUserId: skeleton.skillOwnerUserId,
          skillBindings: skeleton.skillBindings,
          requiredExternalSkills: [],
          presentationSha256: valueHash(presentationOf(metadata)),
          taskContractSha256: valueHash(metadata.subjects.task),
          installArtifacts: {
            workflow: {
              path: `${version}/${f.name}.workflow.zip`,
              bytes: companions!.workflow!.length,
              sha256: sha256(companions!.workflow!),
            },
            skills: [
              {
                slug,
                path: `${version}/${f.name}.skill.zip`,
                bytes: companions!.skills![0]!.bytes.length,
                sha256: sha256(companions!.skills![0]!.bytes),
              },
            ],
          },
        }
      : {}),
  };
  const directory = path.join(f.directory, 'releases');
  mkdirSync(path.join(directory, version), { recursive: true });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = path.join(directory, `${version}.json`);
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(path.join(directory, manifest.artifact.path), canonical);
  if (companions) {
    writeFileSync(
      path.join(directory, manifest.installArtifacts!.workflow.path),
      companions.workflow!,
    );
    writeFileSync(
      path.join(directory, manifest.installArtifacts!.skills[0]!.path),
      companions.skills![0]!.bytes,
    );
  }
  const snapshot = await archive(entries);
  const snapshotPath = `releases/sources/${packTree}.zip`;
  mkdirSync(path.dirname(path.join(f.directory, snapshotPath)), {
    recursive: true,
  });
  writeFileSync(path.join(f.directory, snapshotPath), snapshot);
  const descriptor = {
    ...f.descriptor,
    automations: [
      {
        ...context.automation,
        historicalReleases: [
          {
            version,
            manifestSha256: sha256(manifestBytes),
            sourceRepository: 'https://github.com/example/retired-configs',
            packPath,
            allowExistingNativeReuse: eligible,
            sourceArchive: {
              path: snapshotPath,
              sha256: sha256(snapshot),
              bytes: snapshot.length,
            },
          },
        ],
      },
    ],
  };
  writeFileSync(f.descriptorPath, JSON.stringify(descriptor));
  return {
    ...f,
    manifestPath,
    release: loadRelease(manifestPath, loadClient(f.descriptorPath, f.name)),
  };
}
