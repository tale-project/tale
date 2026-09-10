import { createHash } from 'node:crypto';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { unpack, type Entry } from './archive';
import { isolatedGit } from './git';
import { sha256 } from './identity';
import { insist, type ClientAutomation, type LoadedRelease } from './model';

interface Tree {
  files: Map<string, Entry>;
  directories: Map<string, Tree>;
}
const tree = (): Tree => ({ files: new Map(), directories: new Map() });
const objectHash = (type: string, bytes: Buffer): Buffer =>
  createHash('sha1')
    .update(Buffer.from(`${type} ${bytes.length}\0`))
    .update(bytes)
    .digest();
/** Git hashes names, modes and blob bytes, not archive metadata. Reconstructing
 * its tree proves a retained snapshot is the historic pack even after the old
 * repository is deleted; the historic source commit remains a recorded fact. */
export function gitTreeHash(entries: Entry[]): string {
  const root = tree();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    insist(
      parts.every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          part.toLowerCase() !== '.git',
      ),
      'unsafe source snapshot path',
    );
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      insist(!parent.files.has(part), 'snapshot file/directory collision');
      let child = parent.directories.get(part);
      if (!child) {
        child = tree();
        parent.directories.set(part, child);
      }
      parent = child;
    }
    const name = parts.at(-1) as string;
    insist(
      !parent.files.has(name) && !parent.directories.has(name),
      'duplicate snapshot path',
    );
    parent.files.set(name, entry);
  }
  const hashTree = (node: Tree): Buffer => {
    const children = [
      ...[...node.files].map(([name, entry]) => ({
        name,
        order: name,
        mode: entry.executable ? '100755' : '100644',
        hash: objectHash('blob', entry.bytes),
      })),
      ...[...node.directories].map(([name, child]) => ({
        name,
        order: name + '/',
        mode: '40000',
        hash: hashTree(child),
      })),
    ].sort((a, b) =>
      Buffer.compare(Buffer.from(a.order), Buffer.from(b.order)),
    );
    return objectHash(
      'tree',
      Buffer.concat(
        children.map((child) =>
          Buffer.concat([
            Buffer.from(`${child.mode} ${child.name}\0`),
            child.hash,
          ]),
        ),
      ),
    );
  };
  return hashTree(root).toString('hex');
}
export async function historicalSource(
  context: ClientAutomation,
  release: LoadedRelease,
): Promise<Entry[]> {
  const artifact = release.historical?.sourceArchive;
  insist(artifact, 'historical source snapshot missing');
  const bytes = readFileSync(
    path.resolve(path.dirname(context.descriptorPath), artifact.path),
  );
  insist(
    bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256,
    'historical source archive checksum/size mismatch',
  );
  const entries = await unpack(bytes);
  insist(
    gitTreeHash(entries) === release.manifest.packTree,
    'historical source snapshot differs from recorded git tree',
  );
  return entries;
}
/** The original uncompiled codec was git archive. Rehydrate only our own
 * temporary tree, with force-add so a carried .gitignore cannot omit history. */
export function legacyGitArchive(
  entries: Entry[],
  wrapper: string,
  expectedTree: string,
  writeSource: typeof writeFileSync = writeFileSync,
): Buffer {
  const directory = mkdtempSync(path.join(tmpdir(), 'tale-legacy-source-'));
  try {
    insist(gitTreeHash(entries) === expectedTree, 'legacy source tree differs');
    const emptyConfig = path.join(directory, '.git', 'tale-empty-config');
    mkdirSync(path.dirname(emptyConfig));
    writeFileSync(emptyConfig, '', { flag: 'wx' });
    const git = (...args: string[]) =>
      isolatedGit(directory, emptyConfig, ...args);
    git('init', '--quiet');
    for (const entry of entries) {
      const file = path.join(directory, entry.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeSource(file, entry.bytes, {
        flag: 'wx',
        mode: entry.executable ? 0o755 : 0o644,
      });
    }
    // Source modes belong to the verified snapshot, not the temporary host
    // filesystem. Windows cannot round-trip POSIX executable bits through stat.
    git('-c', 'core.filemode=false', 'add', '-f', '--all');
    for (const entry of entries)
      if (entry.executable) git('update-index', '--chmod=+x', '--', entry.path);
    insist(
      git('write-tree').toString('utf8').trim() === expectedTree,
      'rehydrated git source differs',
    );
    return git(
      'archive',
      '--format=zip',
      '-9',
      '--mtime=2000-01-01T00:00:00Z',
      `--prefix=${wrapper}/`,
      expectedTree,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
