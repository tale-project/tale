// runnerd links every image-baked skill (/opt/agents/skills) into each
// harness's native user-level skill directory. Only Claude Code's directory was
// linked before, so Codex, Gemini CLI, Qwen Code, Pi, Hermes and OpenClaw never
// saw the built-in visual-aspect-analyzer, and nothing withdrew the link when
// the workspace repository shipped a skill of the same name (#2790). Runs the
// real reconcile against temporary roots.

import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  reconcileBakedSkills,
  SKILL_HOMES,
  type BakedSkillPaths,
} from './baked-skills.ts';

const root = mkdtempSync(join(tmpdir(), 'tale-baked-skills-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const VAA = 'visual-aspect-analyzer';
/** Every harness's native user-level skill directory, relative to HOME. */
const SKILL_DIRS = ['.claude/skills', '.agents/skills', '.hermes/skills'];

let caseNo = 0;

/** A fresh bake holding `skills`, an empty session HOME and workspace. */
function fixture(skills: string[]): BakedSkillPaths {
  caseNo += 1;
  const base = join(root, `case-${caseNo}`);
  const paths = {
    baked: join(base, 'opt/agents/skills'),
    home: join(base, 'agent/.runtime/home'),
    workspace: join(base, 'agent/workspace'),
  };
  mkdirSync(paths.baked, { recursive: true });
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
  for (const name of skills) {
    mkdirSync(join(paths.baked, name), { recursive: true });
    writeFileSync(
      join(paths.baked, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: baked ${name}\n---\n`,
    );
  }
  return paths;
}

/** The workspace repository ships its own `name` under `dir`. */
function repoShips(paths: BakedSkillPaths, dir: string, name: string): string {
  const skill = join(paths.workspace, dir, name);
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  return skill;
}

function linksBake(paths: BakedSkillPaths, dir: string, name: string): boolean {
  const entry = join(paths.home, dir, name);
  return (
    lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink() === true &&
    readlinkSync(entry) === join(paths.baked, name)
  );
}

describe('reconcileBakedSkills', () => {
  test('the table covers every directory the harnesses read', () => {
    expect(SKILL_HOMES.map((home) => home.dir)).toEqual(SKILL_DIRS);
  });

  test('links every baked skill into every harness skill directory', () => {
    const paths = fixture([VAA, 'other-skill']);
    reconcileBakedSkills(paths);
    for (const dir of SKILL_DIRS) {
      for (const name of [VAA, 'other-skill']) {
        expect(linksBake(paths, dir, name)).toBe(true);
        expect(
          readFileSync(join(paths.home, dir, name, 'SKILL.md'), 'utf8'),
        ).toContain(`name: ${name}`);
      }
    }
  });

  test('a second run changes nothing and nests no link in the skill', () => {
    const paths = fixture([VAA]);
    reconcileBakedSkills(paths);
    reconcileBakedSkills(paths);
    for (const dir of SKILL_DIRS) {
      expect(linksBake(paths, dir, VAA)).toBe(true);
    }
    expect(existsSync(join(paths.baked, VAA, VAA))).toBe(false);
  });

  test('withdraws the links whose harnesses read the repository copy', () => {
    const paths = fixture([VAA, 'other-skill']);
    reconcileBakedSkills(paths);
    repoShips(paths, '.claude/skills', VAA);
    repoShips(paths, '.agents/skills', VAA);

    reconcileBakedSkills(paths);

    expect(existsSync(join(paths.home, '.claude/skills', VAA))).toBe(false);
    expect(existsSync(join(paths.home, '.agents/skills', VAA))).toBe(false);
    // Hermes reads no project-level skills, so it keeps the baked one.
    expect(linksBake(paths, '.hermes/skills', VAA)).toBe(true);
    for (const dir of SKILL_DIRS) {
      expect(linksBake(paths, dir, 'other-skill')).toBe(true);
    }
  });

  test('withdraws only the link beside the directory the repository uses', () => {
    const paths = fixture([VAA]);
    repoShips(paths, '.agents/skills', VAA);

    reconcileBakedSkills(paths);

    expect(existsSync(join(paths.home, '.agents/skills', VAA))).toBe(false);
    // Claude Code reads no project `.agents/skills`: without the baked link it
    // would list no copy at all.
    expect(linksBake(paths, '.claude/skills', VAA)).toBe(true);
    expect(linksBake(paths, '.hermes/skills', VAA)).toBe(true);
  });

  test('a repository directory without a SKILL.md withdraws nothing', () => {
    const paths = fixture([VAA]);
    mkdirSync(join(paths.workspace, '.claude/skills', VAA), {
      recursive: true,
    });

    reconcileBakedSkills(paths);

    expect(linksBake(paths, '.claude/skills', VAA)).toBe(true);
  });

  test('links again once the repository no longer ships the skill', () => {
    const paths = fixture([VAA]);
    const repoCopy = repoShips(paths, '.claude/skills', VAA);
    reconcileBakedSkills(paths);
    expect(existsSync(join(paths.home, '.claude/skills', VAA))).toBe(false);

    rmSync(repoCopy, { recursive: true });
    reconcileBakedSkills(paths);

    expect(linksBake(paths, '.claude/skills', VAA)).toBe(true);
  });

  test("keeps someone's own skill of the same name, repository or not", () => {
    const paths = fixture([VAA]);
    const own = join(paths.home, '.agents/skills', VAA);
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, 'SKILL.md'), 'own copy');
    const elsewhere = join(paths.home, 'elsewhere', VAA);
    mkdirSync(elsewhere, { recursive: true });
    mkdirSync(join(paths.home, '.claude/skills'), { recursive: true });
    symlinkSync(elsewhere, join(paths.home, '.claude/skills', VAA));

    reconcileBakedSkills(paths);
    repoShips(paths, '.claude/skills', VAA);
    repoShips(paths, '.agents/skills', VAA);
    reconcileBakedSkills(paths);

    expect(lstatSync(own).isDirectory()).toBe(true);
    expect(readFileSync(join(own, 'SKILL.md'), 'utf8')).toBe('own copy');
    expect(existsSync(join(own, VAA))).toBe(false);
    expect(readlinkSync(join(paths.home, '.claude/skills', VAA))).toBe(
      elsewhere,
    );
    expect(linksBake(paths, '.hermes/skills', VAA)).toBe(true);
  });

  test('replaces a dangling link left by an earlier image', () => {
    const paths = fixture([VAA]);
    mkdirSync(join(paths.home, '.agents/skills'), { recursive: true });
    symlinkSync(
      join(paths.home, 'gone', VAA),
      join(paths.home, '.agents/skills', VAA),
    );

    reconcileBakedSkills(paths);

    expect(linksBake(paths, '.agents/skills', VAA)).toBe(true);
  });

  test('a directory it cannot reconcile leaves the others linked', () => {
    const paths = fixture([VAA]);
    mkdirSync(join(paths.home, '.claude'), { recursive: true });
    writeFileSync(join(paths.home, '.claude/skills'), 'not a directory');
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      reconcileBakedSkills(paths);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('~/.claude/skills');
    } finally {
      warn.mockRestore();
    }
    expect(linksBake(paths, '.agents/skills', VAA)).toBe(true);
    expect(linksBake(paths, '.hermes/skills', VAA)).toBe(true);
  });

  test('an image without baked skills creates nothing', () => {
    const paths = fixture([]);
    reconcileBakedSkills(paths);
    reconcileBakedSkills({ ...paths, baked: join(paths.baked, 'missing') });
    for (const dir of SKILL_DIRS) {
      expect(existsSync(join(paths.home, dir))).toBe(false);
    }
  });
});
