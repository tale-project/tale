import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Entry } from './archive';
import {
  insist,
  ExternalToolError,
  type Manifest,
  type ClientAutomation,
} from './model';
import { legacyGitArchive } from './snapshot';

/** Compatibility only: compiler1 used Python's ZIP_STORED headers. Preserve
 * those headers rather than changing historical bytes under its identifier. */
export function legacyStored(
  entries: Entry[],
  writeSource: typeof writeFileSync = writeFileSync,
): Buffer {
  const temporary = mkdtempSync(path.join(tmpdir(), 'tale-legacy-zip-'));
  try {
    const root = path.join(temporary, 'source');
    mkdirSync(root);
    for (const entry of entries) {
      const file = path.join(root, entry.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeSource(file, entry.bytes, {
        mode: entry.executable ? 0o755 : 0o644,
        flag: 'wx',
      });
    }
    const output = path.join(temporary, 'archive.zip');
    // Keep the trusted modes outside the archived source directory. NTFS mode
    // bits cannot represent this metadata, and Windows Path ordering differs
    // from the original POSIX codec for mixed-case and nested names.
    const modes = path.join(temporary, 'modes.json');
    writeFileSync(
      modes,
      JSON.stringify(
        Object.fromEntries(
          entries.map((entry) => [
            entry.path,
            entry.executable ? 0o755 : 0o644,
          ]),
        ),
      ),
      { flag: 'wx' },
    );
    try {
      execFileSync(
        'python3',
        [
          '-c',
          `from pathlib import Path,PurePosixPath
import json,stat,sys,zipfile
root=Path(sys.argv[1]); target=Path(sys.argv[2])
modes=json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_STORED) as output:
 for name in sorted(modes,key=PurePosixPath):
  file=root.joinpath(*PurePosixPath(name).parts)
  info=zipfile.ZipInfo(name,date_time=(2000,1,1,0,0,0))
  info.create_system=3
  info.external_attr=(stat.S_IFREG | modes[name]) << 16
  output.writestr(info,file.read_bytes())
`,
          root,
          output,
          modes,
        ],
        { stdio: 'pipe' },
      );
    } catch {
      throw new ExternalToolError(
        'Historical compiler 1 rebuild requires Python 3 with its zipfile standard library on PATH.',
      );
    }
    return readFileSync(output);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
export function rebuildHistorical(
  source: Entry[],
  manifest: Manifest,
  context: ClientAutomation,
): {
  canonical: Buffer;
  workflow?: Buffer;
  skills?: { slug: string; bytes: Buffer }[];
} {
  if (manifest.schemaVersion === 1) {
    return {
      canonical: legacyGitArchive(
        source,
        manifest.automationName,
        manifest.packTree,
      ),
    };
  }
  insist(
    manifest.schemaVersion === 2 &&
      manifest.compilerVersion === 1 &&
      manifest.skillBindings?.length === 1,
    'unsupported historic compiler',
  );
  const binding = manifest.skillBindings[0];
  insist(
    binding && context.automation.logicalSkillSlugs[0] === binding.logicalSlug,
    'historic logical skill differs',
  );
  const entries = source.map((entry) => {
    let name = entry.path;
    let bytes = entry.bytes;
    if (name.startsWith(`skills/${binding.logicalSlug}/`)) {
      name = `skills/${binding.releaseSlug}/${name.slice(`skills/${binding.logicalSlug}/`.length)}`;
      if (entry.path === `skills/${binding.logicalSlug}/SKILL.md`) {
        const expression = new RegExp(
          `^name: ${binding.logicalSlug}\\r?$`,
          'm',
        );
        bytes = Buffer.from(
          bytes
            .toString('utf8')
            .replace(
              expression,
              `name: ${binding.releaseSlug}\nowner: ${manifest.skillOwnerUserId}`,
            ),
        );
      }
    } else if (name === 'automation.yml' || name === 'workflow.yml') {
      bytes = Buffer.from(
        bytes
          .toString('utf8')
          .replaceAll(binding.logicalSlug, binding.releaseSlug),
      );
    }
    return { ...entry, path: name, bytes };
  });
  const prefix = (entry: Entry): Entry => ({
    ...entry,
    path: `${manifest.automationName}/${entry.path}`,
  });
  const workflow = entries
    .filter((entry) => ['automation.yml', 'workflow.yml'].includes(entry.path))
    .map((entry) =>
      entry.path === 'automation.yml'
        ? {
            path: entry.path,
            executable: entry.executable,
            bytes: Buffer.from(
              entry.bytes
                .toString('utf8')
                .replace(
                  `skills:\n  - ${binding.releaseSlug}\n`,
                  'skills: []\n',
                ),
            ),
          }
        : entry,
    );
  const skills = entries
    .filter((entry) => entry.path.startsWith(`skills/${binding.releaseSlug}/`))
    .map((entry) => ({
      bytes: entry.bytes,
      executable: entry.executable,
      path: entry.path.slice(`skills/${binding.releaseSlug}/`.length),
    }));
  return {
    canonical: legacyStored(entries.map(prefix)),
    workflow: legacyStored(workflow.map(prefix)),
    skills: [{ slug: binding.releaseSlug, bytes: legacyStored(skills) }],
  };
}
