// Built-in skills baked into the runtime image (/opt/agents/skills/<name>).
// runnerd links each one into every harness's native USER-level skill
// directory under the session HOME, so whichever harness runs a turn lists it
// among its own skills and runs it in place (its dependencies live in the
// baked directory). Each directory is verified against the CLI the Dockerfile
// pins (README "Built-in skills"); the image conformance test holds every
// harness in the registry to one.
//
// A skill the workspace repository ships wins over the baked one of the same
// name. User-level links cannot express that on their own: Codex lists both
// copies and OpenCode keeps whichever finishes loading last. So a link is
// withdrawn while the session workspace ships `<name>/SKILL.md` in the project
// directory its harnesses read beside it, and comes back once the repository
// no longer does. Claude Code reads no project-level skills at all — the
// platform starts it on its user setting source alone, so none of the
// workspace's own Claude Code configuration loads — so its directory links
// the repository's skills too, each in place of a baked one of its name.
// runnerd reconciles at boot and again before every exec, so a repository
// cloned during one turn decides the next one.
//
// Only runnerd's own links are touched. A directory, a file or a live link
// someone else put at a link's place is kept; a dangling link (left by an
// earlier image, or by a repository skill since removed) is replaced.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

/** Each harness's native user-level skill directory under HOME, and the
 * workspace directory whose same-named skill withdraws its link — `null`
 * where the harnesses reading it have no project-level skills. With
 * `linkProject`, the workspace's skills there are linked in instead, each in
 * place of a baked one of its name. */
export const SKILL_HOMES: readonly {
  readonly dir: string;
  readonly project: string | null;
  readonly linkProject?: boolean;
}[] = [
  // Claude Code (CLAUDE_CONFIG_DIR), which reads no project-level skills;
  // OpenCode reads it too, and the same skill in the repository beside it.
  { dir: '.claude/skills', project: '.claude/skills', linkProject: true },
  // Codex, Gemini CLI, Qwen Code, Pi, OpenClaw, OpenCode, Cursor.
  { dir: '.agents/skills', project: '.agents/skills' },
  // Hermes (HERMES_HOME).
  { dir: '.hermes/skills', project: null },
];

export interface BakedSkillPaths {
  /** Where the image bakes its skills, one directory per skill. */
  readonly baked: string;
  /** The session HOME every harness runs with. */
  readonly home: string;
  /** The directory every harness turn runs in — the workspace repository's
   * root, where a harness looks for project-level skills. */
  readonly workspace: string;
}

/** A session's paths: the Dockerfile's bake, the entrypoint's HOME, and the
 * `workdir` the platform hands every harness turn. */
const SESSION_SKILL_PATHS: BakedSkillPaths = {
  baked: '/opt/agents/skills',
  home: '/agent/.runtime/home',
  workspace: '/agent/workspace',
};

/**
 * Bring every link in line with the bake and the workspace. Idempotent and
 * synchronous (a few `lstat`s), so no two execs interleave it. Never throws: a
 * directory it cannot reconcile is logged and the others still are.
 */
export function reconcileBakedSkills(
  paths: BakedSkillPaths = SESSION_SKILL_PATHS,
): void {
  let names: string[];
  try {
    names = readdirSync(paths.baked, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    if (isMissing(err)) return;
    console.warn('[runnerd] built-in skills: cannot read the bake:', err);
    return;
  }
  for (const { dir, project, linkProject } of SKILL_HOMES) {
    try {
      const skillsDir = join(paths.home, dir);
      const repoRoot = project === null ? null : join(paths.workspace, project);
      const repoNames =
        linkProject === true && repoRoot !== null ? repoSkills(repoRoot) : [];
      if (repoRoot !== null && linkProject === true) {
        dropStaleRepoLinks(skillsDir, repoRoot, repoNames);
      }
      for (const name of names) {
        const repoShips =
          repoRoot !== null && existsSync(join(repoRoot, name, 'SKILL.md'));
        if (repoShips && linkProject === true && repoRoot !== null) continue;
        reconcileLink(skillsDir, name, join(paths.baked, name), !repoShips);
      }
      if (repoRoot !== null) {
        for (const name of repoNames) {
          reconcileLink(
            skillsDir,
            name,
            join(repoRoot, name),
            true,
            names.includes(name) ? [join(paths.baked, name)] : [],
          );
        }
      }
    } catch (err) {
      console.warn(
        `[runnerd] built-in skills: cannot reconcile ~/${dir}:`,
        err,
      );
    }
  }
}

/** The workspace's skills under `repoRoot`: each directory that holds a
 * SKILL.md. None when the directory is missing. */
function repoSkills(repoRoot: string): string[] {
  let entries;
  try {
    entries = readdirSync(repoRoot, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err) || isNotDirectory(err)) return [];
    throw err;
  }
  return entries
    .filter((entry) => existsSync(join(repoRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

/** Remove runnerd's links to repository skills the workspace no longer
 * ships, so the baked one of that name (if any) links again. */
function dropStaleRepoLinks(
  skillsDir: string,
  repoRoot: string,
  repoNames: readonly string[],
): void {
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || repoNames.includes(entry.name)) continue;
    const link = join(skillsDir, entry.name);
    if (readlinkSync(link) === join(repoRoot, entry.name)) unlinkSync(link);
  }
}

/** Bring one link in line: `target` while `wanted`, nothing otherwise. A
 * link to `target` or to one of `alsoOurs` is runnerd's own and may be
 * replaced; anything else at its place is kept, unless it is a link to
 * nowhere. */
function reconcileLink(
  skillsDir: string,
  name: string,
  target: string,
  wanted: boolean,
  alsoOurs: readonly string[] = [],
): void {
  const link = join(skillsDir, name);
  const stat = lstatSync(link, { throwIfNoEntry: false });
  const pointsAt = stat?.isSymbolicLink() === true ? readlinkSync(link) : null;
  const ours = pointsAt === target;
  if (!wanted) {
    if (ours) unlinkSync(link);
    return;
  }
  if (ours) return;
  if (stat !== undefined) {
    // Someone's own skill of this name, unless it is a link to nowhere or
    // runnerd's own link to the other copy.
    const replaceable =
      (pointsAt !== null && alsoOurs.includes(pointsAt)) ||
      (stat.isSymbolicLink() && !existsSync(link));
    if (!replaceable) return;
    unlinkSync(link);
  }
  mkdirSync(skillsDir, { recursive: true });
  symlinkSync(target, link);
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

function isNotDirectory(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOTDIR'
  );
}
