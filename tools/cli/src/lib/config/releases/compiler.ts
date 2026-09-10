import { parse, parseDocument } from 'yaml';

import { archive, excludedNativePath, type Entry } from './archive';
import { skillBindings, stableJson, valueHash, sha256 } from './identity';
import {
  insist,
  owner,
  record,
  gitSha,
  type Automation,
  type SkillBinding,
} from './model';

export interface Compilation {
  canonical: Buffer;
  workflow: Buffer;
  skills: { slug: string; bytes: Buffer }[];
  skillBindings: SkillBinding[];
  documentSha256: string;
  settingsSha256: string;
  presentationSha256: string;
  taskContractSha256: string;
  skillFiles: { slug: string; path: string; bytes: number; sha256: string }[];
}
export function presentationOf(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    'name',
    'description',
    'icon',
    'labels',
    'i18n',
    'builtinViews',
  ]) {
    if (manifest[key] !== undefined) result[key] = manifest[key];
  }
  if (record(manifest.requires) && manifest.requires.connectors !== undefined)
    result.requiredConnectors = manifest.requires.connectors;
  return result;
}
function yamlRecord(bytes: Buffer): Record<string, unknown> {
  const result: unknown = parse(bytes.toString('utf8'));
  insist(record(result), 'native YAML must contain an object');
  return result;
}
export function assertBindings(
  document: Record<string, unknown>,
  manifest: Record<string, unknown>,
  carried: string[],
  bindings: SkillBinding[],
  external: string[],
): void {
  const owned = bindings.map((item) => item.releaseSlug);
  insist(
    stableJson([...carried].sort()) === stableJson([...owned].sort()) &&
      stableJson(manifest.skills) === stableJson(owned),
    'compiled native skill inventory differs from bindings',
  );
  insist(Array.isArray(document.nodes), 'workflow nodes missing');
  const referenced = new Set<string>();
  const allowed = new Set([...owned, ...external]);
  // Native documents are flat DAGs. Connector input/output objects can resemble
  // nodes, so only declared graph nodes are routing surfaces.
  for (const value of document.nodes) {
    insist(record(value), 'workflow node must be an object');
    if (value.type === 'sandbox.run_script') {
      insist(
        record(value.input) &&
          typeof value.input.skill === 'string' &&
          allowed.has(value.input.skill),
        'script must reference a declared immutable or external skill',
      );
      insist(
        typeof value.input.entry === 'string' && value.input.entry.length > 0,
        'script entry missing',
      );
      referenced.add(value.input.skill);
    }
    if (value.type === 'agent') {
      const skills = value.skills ?? [];
      insist(
        Array.isArray(skills) &&
          skills.every((item) => typeof item === 'string' && allowed.has(item)),
        'agent must reference declared immutable or external skills',
      );
      skills.forEach((item: string) => referenced.add(item));
      for (const field of ['prompt', 'system']) {
        if (typeof value[field] !== 'string') continue;
        for (const binding of bindings)
          insist(
            !mountPattern([binding.logicalSlug]).test(value[field]),
            'workflow retains a mutable logical skill mount',
          );
      }
    }
  }
  insist(
    [...allowed].every((item) => referenced.has(item)),
    'declared skill has no native runtime reference',
  );
}
// Only an explicit skill mount is a path reference. Bare words may be business
// data or JavaScript identifiers; changing those silently changes client logic.
function mountPattern(slugs: string[]): RegExp {
  return new RegExp(`(/skills/)(?:${slugs.join('|')})(?![a-zA-Z0-9_-])`, 'g');
}
function rewrite(
  bytes: Buffer,
  bindings: SkillBinding[],
  manifest: boolean,
): Buffer {
  if (bindings.length === 0) return bytes;
  const document = parseDocument(bytes.toString('utf8'));
  insist(document.errors.length === 0, 'invalid source YAML');
  const mapping = new Map(
    bindings.map((binding) => [binding.logicalSlug, binding.releaseSlug]),
  );
  const route = (value: unknown): unknown =>
    typeof value === 'string' ? (mapping.get(value) ?? value) : value;
  if (manifest) {
    const skills: unknown = document.toJS().skills;
    if (Array.isArray(skills)) document.set('skills', skills.map(route));
  } else {
    const nodes: unknown = document.toJS().nodes;
    insist(Array.isArray(nodes), 'workflow nodes missing');
    for (const node of nodes) {
      insist(record(node), 'workflow node must be an object');
      if (node.type === 'sandbox.run_script' && record(node.input))
        node.input.skill = route(node.input.skill);
      if (node.type !== 'agent') continue;
      if (Array.isArray(node.skills)) node.skills = node.skills.map(route);
      for (const field of ['prompt', 'system']) {
        if (typeof node[field] !== 'string') continue;
        node[field] = node[field].replace(
          mountPattern([...mapping.keys()]),
          (match, prefix: string) =>
            prefix + mapping.get(match.slice(prefix.length)),
        );
      }
    }
    document.set('nodes', nodes);
  }
  return Buffer.from(document.toString({ lineWidth: 0 }));
}
/** The native upload route does not install catalog visibility or triggers.
 * Reject meaningful unsupported behavior before publishing a release. */
function assertInstallableManifest(manifest: Record<string, unknown>): void {
  insist(
    manifest.hidden !== true,
    'native upload does not install hidden visibility',
  );
  insist(
    manifest.triggers === undefined ||
      (Array.isArray(manifest.triggers) && manifest.triggers.length === 0),
    'native upload does not install trigger declarations',
  );
}
/** Zod may accept then strip nested fields. The stored projection must be the
 * same contract we hash, so normalization drift fails before any artifact exists. */
export function assertNativeManifest(
  raw: Record<string, unknown>,
  parsed: Record<string, unknown>,
): void {
  assertInstallableManifest(raw);
  insist(
    stableJson(raw) === stableJson(parsed),
    'native manifest normalization changes release semantics',
  );
}
export async function compile(
  entries: Entry[],
  automation: Automation,
  releaseVersion: string,
  skillOwnerUserId?: string,
): Promise<Compilation> {
  if (automation.logicalSkillSlugs.length) owner.parse(skillOwnerUserId);
  const bindings = skillBindings(automation.logicalSkillSlugs, releaseVersion);
  const compiled: Entry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    // Tale drops dotfiles and generated dependency/cache paths during import.
    // Keep that policy explicit: source provenance retains them, runtime ZIPs do not.
    if (excludedNativePath(entry.path)) continue;
    let name = entry.path;
    let bytes = entry.bytes;
    if (name.startsWith('skills/')) {
      const logical = name.split('/')[1];
      const binding = bindings.find((item) => item.logicalSlug === logical);
      insist(binding, 'source contains undeclared owned skill');
      name = `skills/${binding.releaseSlug}/${name.slice(`skills/${logical}/`.length)}`;
      if (name === `skills/${binding.releaseSlug}/SKILL.md`) {
        const source = bytes.toString('utf8');
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
          source,
        );
        insist(frontmatter, 'skill frontmatter missing');
        const metadata: unknown = parse(frontmatter[1] as string);
        insist(
          record(metadata) &&
            metadata.name === logical &&
            metadata.owner === undefined,
          'source skill identity differs or hardcodes owner',
        );
        const doc = parseDocument(frontmatter[1] as string);
        doc.set('name', binding.releaseSlug);
        doc.set('owner', skillOwnerUserId);
        if (gitSha.safeParse(releaseVersion).success) {
          const extensions = metadata.metadata ?? {};
          insist(
            record(extensions) && extensions['tale-release'] === undefined,
            'source skill must not claim compiler-owned release metadata',
          );
          // Native bytes retain the complete logical identity. A shortened
          // prefix collision in another pack therefore fails byte verification,
          // even when both original skills happened to have identical bodies.
          doc.set('metadata', {
            ...extensions,
            'tale-release': {
              logicalSlug: binding.logicalSlug,
              sourceCommit: releaseVersion,
            },
          });
        }
        bytes = Buffer.from(
          `---\n${doc.toString({ lineWidth: 0 })}---\n${source.slice(frontmatter[0].length)}`,
        );
        seen.add(binding.releaseSlug);
      }
    } else if (name === 'automation.yml' || name === 'workflow.yml') {
      bytes = rewrite(bytes, bindings, name === 'automation.yml');
    } else {
      insist(
        name.endsWith('.md') && !name.includes('/'),
        'unsupported native pack entry',
      );
    }
    compiled.push({ ...entry, path: name, bytes });
  }
  insist(seen.size === bindings.length, 'owned skill frontmatter missing');
  const automationEntry = compiled.find(
    (item) => item.path === 'automation.yml',
  );
  const workflowEntry = compiled.find((item) => item.path === 'workflow.yml');
  insist(
    automationEntry && workflowEntry,
    'native automation/workflow files required',
  );
  const native = yamlRecord(automationEntry.bytes);
  const document = yamlRecord(workflowEntry.bytes);
  assertInstallableManifest(native);
  insist(
    document.name === automation.name && native.name === automation.displayName,
    'source automation identity differs from descriptor',
  );
  insist(
    native.scope === 'project',
    'release deployment requires a project-scoped automation',
  );
  assertBindings(
    document,
    native,
    [...seen],
    bindings,
    automation.requiredExternalSkills,
  );
  const workflowManifest = parseDocument(
    automationEntry.bytes.toString('utf8'),
  );
  workflowManifest.set('skills', []);
  const wrapper = (entry: Entry): Entry => ({
    ...entry,
    path: `${automation.name}/${entry.path}`,
  });
  const skills = bindings.map((binding) => ({
    slug: binding.releaseSlug,
    entries: compiled
      .filter((entry) =>
        entry.path.startsWith(`skills/${binding.releaseSlug}/`),
      )
      .map((entry) => ({
        bytes: entry.bytes,
        executable: entry.executable,
        path: entry.path.slice(`skills/${binding.releaseSlug}/`.length),
      })),
  }));
  return {
    canonical: await archive(compiled.map(wrapper)),
    workflow: await archive([
      wrapper({
        ...automationEntry,
        bytes: Buffer.from(workflowManifest.toString({ lineWidth: 0 })),
      }),
      wrapper(workflowEntry),
    ]),
    skills: await Promise.all(
      skills.map(async (skill) => ({
        slug: skill.slug,
        bytes: await archive(skill.entries),
      })),
    ),
    skillBindings: bindings,
    documentSha256: valueHash(document),
    settingsSha256: valueHash(native.settings ?? null),
    presentationSha256: valueHash(presentationOf(native)),
    taskContractSha256: valueHash(
      record(native.subjects) ? (native.subjects.task ?? null) : null,
    ),
    skillFiles: skills
      .flatMap((skill) =>
        skill.entries.map((entry) => ({
          slug: skill.slug,
          path: entry.path,
          bytes: entry.bytes.length,
          sha256: sha256(entry.bytes),
        })),
      )
      .sort((a, b) => (`${a.slug}/${a.path}` < `${b.slug}/${b.path}` ? -1 : 1)),
  };
}
