// The session entrypoint links every image-baked skill (/opt/agents/skills)
// into each harness's native user-level skill directory. Only Claude Code's
// directory was linked before, so Codex, Gemini CLI, Qwen Code, Pi, Hermes and
// OpenClaw never saw the built-in visual-aspect-analyzer (#2790). Runs the real
// `link_baked_skills` helper under sh against temporary roots — the helpers
// above the dispatch have no side effect until called.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
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
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tale-baked-skills-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const source = readFileSync(
  resolve(import.meta.dir, '../../entrypoint.sh'),
  'utf8',
);
const helpersEnd = source.indexOf('# K8s transparent-egress native sidecar.');
if (helpersEnd < 0) throw new Error('entrypoint helpers marker not found');
const helpers = source.slice(0, helpersEnd);

/** Every harness's native user-level skill directory, relative to HOME. */
const SKILL_DIRS = ['.claude/skills', '.agents/skills', '.hermes/skills'];

let caseNo = 0;

/** A fresh baked root holding `skills` and an empty session HOME. */
function fixture(skills: string[]): { baked: string; home: string } {
  caseNo += 1;
  const base = join(root, `case-${caseNo}`);
  const baked = join(base, 'opt/agents/skills');
  const home = join(base, 'agent/.runtime/home');
  mkdirSync(home, { recursive: true });
  for (const name of skills) {
    mkdirSync(join(baked, name), { recursive: true });
    writeFileSync(
      join(baked, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: baked ${name}\n---\n`,
    );
  }
  return { baked, home };
}

function link(baked: string, home: string): void {
  const script = helpers
    .replaceAll('/opt/agents/skills', baked)
    .replaceAll('/agent/.runtime/home', home);
  const run = spawnSync('sh', ['-c', `${script}\nDROP=""\nlink_baked_skills`], {
    encoding: 'utf8',
  });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
}

describe('link_baked_skills', () => {
  test('links every baked skill into every harness skill directory', () => {
    const { baked, home } = fixture(['visual-aspect-analyzer', 'other-skill']);
    link(baked, home);
    for (const dir of SKILL_DIRS) {
      for (const name of ['visual-aspect-analyzer', 'other-skill']) {
        const entry = join(home, dir, name);
        expect(lstatSync(entry).isSymbolicLink()).toBe(true);
        expect(readlinkSync(entry)).toBe(join(baked, name));
        expect(readFileSync(join(entry, 'SKILL.md'), 'utf8')).toContain(
          `name: ${name}`,
        );
      }
    }
  });

  test('a second start changes nothing and nests no link in the skill', () => {
    const { baked, home } = fixture(['visual-aspect-analyzer']);
    link(baked, home);
    link(baked, home);
    for (const dir of SKILL_DIRS) {
      expect(readlinkSync(join(home, dir, 'visual-aspect-analyzer'))).toBe(
        join(baked, 'visual-aspect-analyzer'),
      );
    }
    expect(
      existsSync(join(baked, 'visual-aspect-analyzer/visual-aspect-analyzer')),
    ).toBe(false);
  });

  test("keeps someone's own skill of the same name", () => {
    const { baked, home } = fixture(['visual-aspect-analyzer']);
    const own = join(home, '.agents/skills/visual-aspect-analyzer');
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, 'SKILL.md'), 'own copy');
    const elsewhere = join(home, 'elsewhere/visual-aspect-analyzer');
    mkdirSync(elsewhere, { recursive: true });
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    symlinkSync(elsewhere, join(home, '.claude/skills/visual-aspect-analyzer'));

    link(baked, home);

    expect(lstatSync(own).isDirectory()).toBe(true);
    expect(readFileSync(join(own, 'SKILL.md'), 'utf8')).toBe('own copy');
    expect(existsSync(join(own, 'visual-aspect-analyzer'))).toBe(false);
    expect(
      readlinkSync(join(home, '.claude/skills/visual-aspect-analyzer')),
    ).toBe(elsewhere);
    expect(
      readlinkSync(join(home, '.hermes/skills/visual-aspect-analyzer')),
    ).toBe(join(baked, 'visual-aspect-analyzer'));
  });

  test('replaces a dangling link left by an earlier image', () => {
    const { baked, home } = fixture(['visual-aspect-analyzer']);
    mkdirSync(join(home, '.agents/skills'), { recursive: true });
    const stale = join(home, '.agents/skills/visual-aspect-analyzer');
    symlinkSync(join(home, 'gone/visual-aspect-analyzer'), stale);

    link(baked, home);

    expect(readlinkSync(stale)).toBe(join(baked, 'visual-aspect-analyzer'));
  });

  test('an image without baked skills creates nothing', () => {
    const { baked, home } = fixture([]);
    link(baked, home);
    for (const dir of SKILL_DIRS) {
      expect(existsSync(join(home, dir))).toBe(false);
    }
  });
});
