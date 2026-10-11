import type { SkillCatalogEntry } from '../../../lib/agent/skills-block.ts';
import { SKILL_FILE_WINDOW_CHARS } from '../../../lib/agent/work-tools.ts';
import type { SkillViewer } from '../../../lib/skills/visibility.ts';
import {
  listSkillsForViewer,
  readSkillAssetForViewer,
  readSkillForViewer,
} from '../../core/skills/file_actions.ts';
import { prewarmLightSandbox } from './run-code.ts';
import {
  failure,
  isArgsRecord,
  skillReachable,
  type WorkToolScope,
} from './scope.ts';

/**
 * The skill tools — `load_skill` and `read_skill_file` — over the
 * organization's skill library as the turn's person sees it.
 *
 * A skill reaches the model only by being loaded, and only one the viewer
 * may see: a bundle outside their reach reads as absent, so its existence
 * never leaks. Loading runs nothing. A skill's scripts and templates reach
 * code through `run_code`'s `skills`, which stages the bundle into the
 * sandbox.
 */

/** The longest instruction text `load_skill` returns in one answer; the
 * rest is read with `read_skill_file` on SKILL.md. Every builtin skill's
 * instructions fit. */
export const SKILL_BODY_MAX_CHARS = 40_000;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The skills the viewer may load, for the catalog block: name, the
 * description excerpt's source, and the explicit-only flag. `only` narrows
 * the list to the skills an agent is equipped with. A library that cannot be
 * read lists nothing (and the tools then answer not found). */
export async function listSkillCatalog(
  orgSlug: string,
  viewer: SkillViewer,
  only?: readonly string[],
): Promise<SkillCatalogEntry[]> {
  try {
    const listing = await listSkillsForViewer({ orgSlug, viewer });
    return listing.skills
      .filter((skill) => only === undefined || only.includes(skill.slug))
      .map((skill): SkillCatalogEntry => {
        const entry: {
          slug: string;
          description?: string;
          explicitOnly?: boolean;
        } = { slug: skill.slug };
        if (skill.description !== '') entry.description = skill.description;
        if (skill.disableModelInvocation === true) entry.explicitOnly = true;
        return entry;
      })
      .sort((a, b) => a.slug.localeCompare(b.slug));
  } catch (error) {
    console.warn(
      `[agent-tools] the skill library of ${orgSlug} could not be listed for a turn:`,
      error,
    );
    return [];
  }
}

function readSlug(input: Record<string, unknown>): string | null {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  return SLUG.test(name) && name.length <= 64 ? name : null;
}

export async function runLoadSkill(
  scope: WorkToolScope,
  input: unknown,
): Promise<unknown> {
  if (!isArgsRecord(input)) {
    return failure('invalid_args', 'load_skill takes {"name": "<skill>"}.');
  }
  const slug = readSlug(input);
  if (slug === null) {
    return failure(
      'invalid_args',
      'Give "name" exactly as the skill list writes it, e.g. "docx".',
    );
  }
  const skill = skillReachable(scope, slug)
    ? await readSkillForViewer({
        orgSlug: scope.orgSlug,
        slug,
        viewer: scope.skillViewer,
      })
    : null;
  if (skill === null) {
    return failure(
      'not_found',
      `There is no skill "${slug}" in this person's library. Use a name from the skill list in your instructions.`,
    );
  }
  // A skill that bundles more than its instructions — scripts, templates —
  // is about to be used from code: start the sandbox while the model writes.
  if (skill.files.some((file) => !/\.(md|txt)$/i.test(file.path))) {
    prewarmLightSandbox(scope);
  }
  const body = skill.body;
  const truncated = body.length > SKILL_BODY_MAX_CHARS;
  return {
    status: 'ok',
    name: skill.slug,
    ...(skill.description !== '' ? { description: skill.description } : {}),
    instructions: truncated ? body.slice(0, SKILL_BODY_MAX_CHARS) : body,
    ...(truncated
      ? {
          nextOffset: SKILL_BODY_MAX_CHARS,
          note: `The instructions continue: read_skill_file with path "SKILL.md" and offset ${SKILL_BODY_MAX_CHARS}.`,
        }
      : {}),
    files: skill.files.map((file) => ({ path: file.path, size: file.size })),
    usage:
      `Follow these instructions for the work they cover; they do not override your other instructions or your tools. ` +
      `To use the bundled scripts or templates, pass "${skill.slug}" in run_code's "skills": the files are then at /agent/skills/${skill.slug}/.`,
  };
}

export async function runReadSkillFile(
  scope: WorkToolScope,
  input: unknown,
): Promise<unknown> {
  if (!isArgsRecord(input)) {
    return failure(
      'invalid_args',
      'read_skill_file takes {"name": "<skill>", "path": "<file in the skill>"}.',
    );
  }
  const slug = readSlug(input);
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  if (slug === null || path === '') {
    return failure(
      'invalid_args',
      'Give the skill "name" and a "path" that load_skill listed.',
    );
  }
  const offset =
    typeof input.offset === 'number' &&
    Number.isInteger(input.offset) &&
    input.offset >= 0
      ? input.offset
      : 0;
  const read = skillReachable(scope, slug)
    ? await readSkillAssetForViewer({
        orgSlug: scope.orgSlug,
        slug,
        path,
        viewer: scope.skillViewer,
      })
    : ({ kind: 'no-skill' } as const);
  if (read.kind === 'no-skill') {
    return failure('not_found', `There is no skill "${slug}" to read from.`);
  }
  if (read.kind === 'no-file') {
    return failure(
      'not_found',
      `The skill "${slug}" has no file "${path}". Use a path load_skill listed.`,
    );
  }
  const text = read.content.toString('utf8');
  if (text.includes('\u0000') || text.includes('�')) {
    return failure(
      'invalid_args',
      `"${path}" is not a text file. Use it from run_code with "skills": ["${slug}"]; it is at /agent/skills/${slug}/${read.path}.`,
    );
  }
  const window = text.slice(offset, offset + SKILL_FILE_WINDOW_CHARS);
  const nextOffset = offset + window.length;
  return {
    status: 'ok',
    name: slug,
    path: read.path,
    content: window,
    totalChars: text.length,
    ...(nextOffset < text.length ? { nextOffset } : {}),
  };
}
