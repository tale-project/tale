/**
 * Skill precedence: a repo's own skills win over Tale-provided ones.
 *
 * When Tale runs an external agent (Claude Code / Codex / …) in a sandbox, it
 * stages its OWN skills (integration-*, browser-human-control, and any bundled
 * builtin skill) into the agent's USER-level skill dir (`~/.claude/skills`). A
 * repo checked out in the workspace can define its OWN PROJECT-level skills
 * under `.claude/skills/` or `.codex/skills/`. The repo is authoritative: on an
 * exact skill-name collision the repo's skill wins, and Tale does NOT stage its
 * own — so the agent never loads two skills with the same name/id.
 *
 * This is a pure filter. The caller discovers the repo's skill names from the
 * workspace and passes the Tale skills it intends to stage; the dropped Tale
 * skills are the ones the repo already provides.
 */
export interface SkillPrecedenceResult<T> {
  /** Tale skills to stage (no name collision with a repo skill). */
  readonly kept: T[];
  /** Names of Tale skills withheld because the repo provides one with that name. */
  readonly dropped: string[];
}

/**
 * Drop every Tale skill whose name an authoritative repo skill already claims.
 * Name match is exact (the skill id is its kebab-case `name`/slug).
 */
export function selectStageableSkills<T>(
  taleSkills: readonly T[],
  nameOf: (skill: T) => string,
  repoSkillNames: ReadonlySet<string>,
): SkillPrecedenceResult<T> {
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const skill of taleSkills) {
    if (repoSkillNames.has(nameOf(skill))) {
      dropped.push(nameOf(skill));
    } else {
      kept.push(skill);
    }
  }
  return { kept, dropped };
}
