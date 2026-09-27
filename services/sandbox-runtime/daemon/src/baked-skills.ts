// Built-in skills baked into the runtime image (/opt/agents/skills/<name>).
// runnerd links each one into every harness's native USER-level skill
// directory under the session HOME, so whichever harness runs a turn lists it
// among its own skills and runs it in place (its dependencies live in the
// baked directory). Each directory is verified against the CLI the Dockerfile
// pins (README "Built-in skills"); the image conformance test holds every
// harness in the registry to one.
//
// A skill the workspace repository ships wins over the baked one of the same
// name. User-level links cannot express that on their own: Claude Code ranks
// user skills above project skills, Codex lists both copies and OpenCode keeps
// whichever finishes loading last. So a link is withdrawn while the session
// workspace ships `<name>/SKILL.md` in the project directory its harnesses
// read beside it, and comes back once the repository no longer does. runnerd
// reconciles at boot and again before every exec, so a repository cloned
// during one turn decides the next one.
//
// Only runnerd's own links are touched. A directory, a file or a live link
// someone else put at a link's place is kept; a dangling link (left by an
// earlier image) is replaced.

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
 * where the harnesses reading it have no project-level skills. */
export const SKILL_HOMES: readonly {
  readonly dir: string;
  readonly project: string | null;
}[] = [
  // Claude Code (CLAUDE_CONFIG_DIR); OpenCode reads it too.
  { dir: '.claude/skills', project: '.claude/skills' },
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
  for (const { dir, project } of SKILL_HOMES) {
    try {
      for (const name of names) {
        const repoShips =
          project !== null &&
          existsSync(join(paths.workspace, project, name, 'SKILL.md'));
        reconcileLink(
          join(paths.home, dir),
          name,
          join(paths.baked, name),
          !repoShips,
        );
      }
    } catch (err) {
      console.warn(
        `[runnerd] built-in skills: cannot reconcile ~/${dir}:`,
        err,
      );
    }
  }
}

function reconcileLink(
  skillsDir: string,
  name: string,
  target: string,
  wanted: boolean,
): void {
  const link = join(skillsDir, name);
  const stat = lstatSync(link, { throwIfNoEntry: false });
  const ours = stat?.isSymbolicLink() === true && readlinkSync(link) === target;
  if (!wanted) {
    if (ours) unlinkSync(link);
    return;
  }
  if (ours) return;
  if (stat !== undefined) {
    // Someone's own skill of this name, unless it is a link to nowhere.
    if (!stat.isSymbolicLink() || existsSync(link)) return;
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
