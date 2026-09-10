import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { Entry } from './archive';
import { parseClient, repoPath } from './identity';
import {
  gitSha,
  insist,
  relativePath,
  ExternalToolError,
  type ClientAutomation,
} from './model';

export function git(repoRoot: string, ...args: string[]): Buffer {
  return runGit(repoRoot, undefined, args);
}
/** Historical blobs must not pass through user filters or newline conversion.
 * Keep an empty, owned config file under .git and ignore external Git overrides. */
export function isolatedGit(
  repoRoot: string,
  emptyConfig: string,
  ...args: string[]
): Buffer {
  return runGit(repoRoot, emptyConfig, args);
}
function runGit(
  repoRoot: string,
  emptyConfig: string | undefined,
  args: string[],
): Buffer {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  env.GIT_NO_REPLACE_OBJECTS = '1';
  if (emptyConfig) {
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.GIT_CONFIG_GLOBAL = emptyConfig;
    env.GIT_ATTR_NOSYSTEM = '1';
  }
  try {
    return execFileSync(
      'git',
      [
        '-C',
        repoRoot,
        ...(emptyConfig
          ? [
              '-c',
              'core.autocrlf=false',
              '-c',
              'core.safecrlf=false',
              '-c',
              `core.attributesFile=${emptyConfig}`,
              '-c',
              'init.templateDir=',
            ]
          : []),
        ...args,
      ],
      {
        maxBuffer: 100_000_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      },
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new ExternalToolError(
        'Git is required on PATH for source and historical verification.',
      );
    if (args[0] === 'archive')
      throw new ExternalToolError(
        'Historical rebuild requires Git with working archive --mtime support.',
      );
    throw error;
  }
}
export function committedClient(
  repoRoot: string,
  descriptorPath: string,
  automationName: string,
  sourceCommit: string,
): { context: ClientAutomation; bytes: Buffer; descriptorPath: string } {
  gitSha.parse(sourceCommit);
  insist(
    git(repoRoot, 'cat-file', '-t', sourceCommit).toString('utf8').trim() ===
      'commit',
    'source identity must be a full commit object',
  );
  const relative = repoPath(repoRoot, descriptorPath);
  const bytes = git(repoRoot, 'show', `${sourceCommit}:${relative}`);
  return {
    context: parseClient(
      bytes.toString('utf8'),
      path.join(repoRoot, relative),
      automationName,
    ),
    bytes,
    descriptorPath: relative,
  };
}
export function treeHash(
  repoRoot: string,
  sourceCommit: string,
  packPath: string,
): string {
  gitSha.parse(sourceCommit);
  relativePath.parse(packPath);
  const tree = git(repoRoot, 'rev-parse', `${sourceCommit}:${packPath}`)
    .toString('utf8')
    .trim();
  gitSha.parse(tree);
  insist(
    git(repoRoot, 'cat-file', '-t', tree).toString('utf8').trim() === 'tree',
    'source pack is not a git tree',
  );
  return tree;
}
export function committedEntries(
  repoRoot: string,
  sourceCommit: string,
  packPath: string,
): Entry[] {
  const tree = treeHash(repoRoot, sourceCommit, packPath);
  return git(repoRoot, 'ls-tree', '-r', '-z', tree)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      insist(match, 'source pack must contain only regular files');
      const file = relativePath.parse(match[3]);
      return {
        path: file,
        executable: match[1] === '100755',
        bytes: git(repoRoot, 'cat-file', 'blob', match[2] as string),
      };
    });
}
