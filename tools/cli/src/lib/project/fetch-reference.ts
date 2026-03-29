import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const REFERENCE_DIRS: [string, string][] = [
  ['services/platform/lib/shared/schemas', 'schemas'],
  ['services/platform/convex/agents', 'convex/agents'],
  ['services/platform/convex/workflows', 'convex/workflows'],
  ['services/platform/convex/integrations', 'convex/integrations'],
  ['examples', 'examples'],
];

export function resolveRepoRoot(): string | null {
  // Walk up from the CLI source directory looking for the monorepo root
  let dir = resolve(dirname(Bun.main));

  while (true) {
    const examplesDir = join(dir, 'examples');
    const agentsDir = join(dir, 'examples', 'agents');
    const workflowsDir = join(dir, 'examples', 'workflows');

    if (
      existsSync(examplesDir) &&
      existsSync(agentsDir) &&
      existsSync(workflowsDir)
    ) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export async function fetchReference(
  projectDir: string,
  repoRoot: string,
): Promise<void> {
  const referenceDir = join(projectDir, '.tale', 'reference');

  // Remove existing reference dir and recreate
  if (existsSync(referenceDir)) {
    await rm(referenceDir, { recursive: true });
  }
  await mkdir(referenceDir, { recursive: true });

  for (const [srcRel, destRel] of REFERENCE_DIRS) {
    const src = join(repoRoot, srcRel);
    const dest = join(referenceDir, destRel);

    if (!existsSync(src)) {
      continue;
    }

    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true });
  }

  // TODO: Add production mode — download GitHub archive at version tag
  // when monorepo is not available (compiled binary distribution).
  // URL: https://github.com/{owner}/{repo}/archive/refs/tags/v{version}.tar.gz
}
