import { parse } from 'yaml';

import { unpack, excludedNativePath, type Entry } from './archive';
import { presentationOf, assertBindings } from './compiler';
import { sha256, stableJson, valueHash } from './identity';
import { insist, record, type LoadedRelease } from './model';

function read(entries: Entry[], file: string): Buffer {
  const entry = entries.find((item) => item.path === file);
  insist(entry, 'required native pack file missing');
  return entry.bytes;
}
/** Complete local projection proof before credentials or native writes. */
export async function verifyArtifactBytes(
  release: LoadedRelease,
): Promise<void> {
  const { manifest, installation } = release;
  const entries = await unpack(release.bytes);
  const prefix = `${manifest.automationName}/`;
  insist(
    entries.every((item) => item.path.startsWith(prefix)),
    'canonical pack has an unexpected wrapper',
  );
  const document: unknown = parse(
    read(entries, prefix + 'workflow.yml').toString('utf8'),
  );
  const metadata: unknown = parse(
    read(entries, prefix + 'automation.yml').toString('utf8'),
  );
  insist(
    record(document) &&
      record(metadata) &&
      document.name === manifest.automationName &&
      metadata.name === manifest.displayName,
    'canonical automation identity differs',
  );
  insist(
    valueHash(document) === manifest.documentSha256 &&
      valueHash(metadata.settings ?? null) === manifest.settingsSha256,
    'canonical workflow/settings checksum mismatch',
  );
  const skillFiles = entries.filter(
    (item) =>
      item.path.startsWith(prefix + 'skills/') &&
      !excludedNativePath(item.path),
  );
  const actual = skillFiles.map((file) => {
    const relative = file.path.slice((prefix + 'skills/').length);
    const slash = relative.indexOf('/');
    return {
      slug: relative.slice(0, slash),
      path: relative.slice(slash + 1),
      bytes: file.bytes.length,
      sha256: sha256(file.bytes),
    };
  });
  const sorted = (files: typeof actual) =>
    [...files].sort((a, b) =>
      `${a.slug}/${a.path}` < `${b.slug}/${b.path}` ? -1 : 1,
    );
  insist(
    stableJson(sorted(actual)) === stableJson(sorted(manifest.skillFiles)),
    'canonical skill bytes/inventory differ from manifest',
  );
  if (manifest.schemaVersion === 1) return;
  insist(
    installation && manifest.skillBindings && manifest.requiredExternalSkills,
    'compiled installation missing',
  );
  insist(
    valueHash(presentationOf(metadata)) === manifest.presentationSha256 &&
      valueHash(
        record(metadata.subjects) ? (metadata.subjects.task ?? null) : null,
      ) === manifest.taskContractSha256,
    'canonical presentation/task contract mismatch',
  );
  assertBindings(
    document,
    metadata,
    manifest.skillSlugs,
    manifest.skillBindings,
    manifest.requiredExternalSkills,
  );
  const transport = await unpack(installation.workflow.bytes);
  insist(
    stableJson(transport.map((item) => item.path)) ===
      stableJson([prefix + 'automation.yml', prefix + 'workflow.yml']),
    'workflow-only transport must carry exactly two files and zero skills',
  );
  insist(
    read(transport, prefix + 'workflow.yml').equals(
      read(entries, prefix + 'workflow.yml'),
    ),
    'workflow transport document differs',
  );
  insist(
    stableJson(
      parse(read(transport, prefix + 'automation.yml').toString('utf8')),
    ) === stableJson({ ...metadata, skills: [] }),
    'workflow transport metadata differs beyond empty skills',
  );
  for (const skill of installation.skills) {
    const files = (await unpack(skill.bytes)).filter(
      (entry) => !excludedNativePath(entry.path),
    );
    const expected = skillFiles.filter((item) =>
      item.path.startsWith(prefix + `skills/${skill.slug}/`),
    );
    insist(
      files.length === expected.length,
      'skill transport file inventory differs',
    );
    for (const entry of files)
      insist(
        read(entries, prefix + `skills/${skill.slug}/${entry.path}`).equals(
          entry.bytes,
        ),
        'skill transport bytes differ',
      );
    const source = read(files, 'SKILL.md').toString('utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    const skillMetadata: unknown = frontmatter
      ? parse(frontmatter[1] as string)
      : null;
    insist(
      record(skillMetadata) &&
        skillMetadata.name === skill.slug &&
        skillMetadata.owner === manifest.skillOwnerUserId,
      'canonical skill name/owner differs',
    );
    if (manifest.schemaVersion === 4) {
      const binding = manifest.skillBindings.find(
        (item) => item.releaseSlug === skill.slug,
      );
      insist(
        binding &&
          record(skillMetadata.metadata) &&
          stableJson(skillMetadata.metadata['tale-release']) ===
            stableJson({
              logicalSlug: binding.logicalSlug,
              sourceCommit: manifest.sourceCommit,
            }),
        'canonical skill loses its full logical/source identity',
      );
    }
  }
}
