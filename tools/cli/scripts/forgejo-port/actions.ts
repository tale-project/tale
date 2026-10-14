/**
 * What each action a workflow uses becomes on Forgejo.
 *
 * `uses: owner/repo@sha` is resolved by the runner against the instance's own
 * `owner/repo` (a pull mirror, `DEFAULT_ACTIONS_URL = self`), so an action that
 * works unchanged needs nothing but its mirror. The ones that do not are named
 * here, each with why, so a reviewer reads the whole list in one place.
 */

import { Scalar, YAMLMap, isMap, visit } from 'yaml';
import type { Document } from 'yaml';

import { jobKnowledge, type Rule } from './context';
import { parseUses, stepLists, stringOf } from './workflow';

/**
 * Forgejo's own builds of the artifact actions. The upstream v4+ clients refuse every
 * server that is not github.com (`isGhes()`); these are upstream's v5 and v7 with that
 * check removed, at the commits Forgejo tags (code.forgejo.org/forgejo/upload-artifact
 * `v5`, code.forgejo.org/forgejo/download-artifact `v7`). Measured on a Forgejo 15.0.9 with
 * a runner 13.2.0 (2026-10-14): upload `v5`, `v4` and `v3-node20` upload, and download `v5`,
 * `v6` and `v7` download by name, by id and by pattern; upload `branch-v6` is refused at the
 * upload itself, because its client drops the padding of the signature in the signed URL.
 */
export const UPLOAD_ARTIFACT = {
  name: 'forgejo/upload-artifact',
  sha: 'cb8afe72b42edc798abfb8fcb556cf660d894245',
  comment: ' v5, patched for Forgejo',
} as const;
export const DOWNLOAD_ARTIFACT = {
  name: 'forgejo/download-artifact',
  sha: '769f970437aa3291b13f35dc23fc87967d7fb19f',
  comment: ' v7, patched for Forgejo',
} as const;

export type ActionDisposition =
  /** Works as it is, from its pull mirror. */
  | { readonly kind: 'keep' }
  /** Another action does the same on Forgejo. */
  | {
      readonly kind: 'replace';
      readonly to: typeof UPLOAD_ARTIFACT | typeof DOWNLOAD_ARTIFACT;
    }
  /** The step is removed, and says why. */
  | { readonly kind: 'drop'; readonly why: string }
  /** It cannot work on Forgejo: a workflow that still has it is not ported. */
  | { readonly kind: 'unportable'; readonly why: string };

const CACHE_WHY =
  "the runner's cache is per instance and the instance is deleted with its job: a restore always misses and a save only spends time";

export const ACTIONS: ReadonlyMap<string, ActionDisposition> = new Map<
  string,
  ActionDisposition
>([
  ['actions/checkout', { kind: 'keep' }],
  ['actions/setup-node', { kind: 'keep' }],
  ['oven-sh/setup-bun', { kind: 'keep' }],
  ['astral-sh/setup-uv', { kind: 'keep' }],
  ['docker/setup-buildx-action', { kind: 'keep' }],
  ['docker/setup-qemu-action', { kind: 'keep' }],
  ['docker/build-push-action', { kind: 'keep' }],
  ['docker/bake-action', { kind: 'keep' }],
  ['docker/login-action', { kind: 'keep' }],
  ['aquasecurity/trivy-action', { kind: 'keep' }],
  ['dorny/paths-filter', { kind: 'keep' }],
  [UPLOAD_ARTIFACT.name, { kind: 'keep' }],
  [DOWNLOAD_ARTIFACT.name, { kind: 'keep' }],
  ['actions/upload-artifact', { kind: 'replace', to: UPLOAD_ARTIFACT }],
  ['actions/download-artifact', { kind: 'replace', to: DOWNLOAD_ARTIFACT }],
  ['actions/cache', { kind: 'drop', why: CACHE_WHY }],
  ['actions/cache/restore', { kind: 'drop', why: CACHE_WHY }],
  ['actions/cache/save', { kind: 'drop', why: CACHE_WHY }],
  [
    'github/codeql-action/upload-sarif',
    {
      kind: 'drop',
      why: 'it feeds GitHub code scanning, which Forgejo does not have',
    },
  ],
  [
    'actions/github-script',
    {
      kind: 'unportable',
      why: "it calls GitHub's REST API, whose shapes Forgejo's API does not share",
    },
  ],
  [
    'ossf/scorecard-action',
    {
      kind: 'unportable',
      why: 'it publishes to GitHub and needs its OIDC identity',
    },
  ],
]);

export interface ExternalAction {
  readonly name: string;
  readonly ref: string;
}

/** Every external action a document uses, with the ref it pins. */
export function externalActions(
  doc: Parameters<typeof stepLists>[0],
): ExternalAction[] {
  const found: ExternalAction[] = [];
  for (const { steps } of stepLists(doc)) {
    for (const step of steps.items) {
      const uses = isMap(step) ? stringOf(step.get('uses')) : undefined;
      const parsed = uses === undefined ? undefined : parseUses(uses);
      if (parsed?.kind === 'remote')
        found.push({ name: parsed.name, ref: parsed.ref });
    }
  }
  return found;
}

function usesOf(step: unknown): string | undefined {
  return isMap(step) ? stringOf(step.get('uses')) : undefined;
}

/** Rewrite, remove or flag every step by what its action becomes. */
export const rewriteActions: Rule = (doc, context) => {
  const { file, report, knowledge } = context;
  for (const { at, steps } of stepLists(doc)) {
    for (let index = steps.items.length - 1; index >= 0; index -= 1) {
      const step = steps.items[index];
      const uses = usesOf(step);
      if (!isMap(step) || uses === undefined) continue;
      const parsed = parseUses(uses);
      if (parsed.kind !== 'remote') continue;
      const disposition = ACTIONS.get(parsed.name);
      const where = `${at}.steps[${index}]`;
      if (!disposition) {
        report.warnings.push({
          file,
          at: where,
          rule: 'unknown-action',
          detail: `\`${parsed.name}\` is not in the port's action table: add it, and its pull mirror`,
        });
        continue;
      }
      if (disposition.kind === 'keep') continue;
      if (disposition.kind === 'replace') {
        const node = step.get('uses', true);
        const next = `${disposition.to.name}@${disposition.to.sha}`;
        if (node instanceof Scalar) {
          node.value = next;
          node.comment = disposition.to.comment;
        } else step.set('uses', next);
        report.changes.push({
          file,
          at: where,
          rule: 'action-replaced',
          detail: `\`${parsed.name}\` is \`${disposition.to.name}\`: upstream's refuses a Forgejo server`,
        });
        continue;
      }
      if (disposition.kind === 'unportable') {
        report.warnings.push({
          file,
          at: where,
          rule: 'action-unportable',
          detail: `\`${parsed.name}\`: ${disposition.why}`,
        });
        continue;
      }
      const id = stringOf(step.get('id'));
      steps.items.splice(index, 1);
      if (id !== undefined) {
        const owner = at.startsWith('jobs.')
          ? jobKnowledge(knowledge, at.slice('jobs.'.length)).absent
          : knowledge.absent;
        owner.push(`steps.${id}.outputs`);
      }
      report.changes.push({
        file,
        at: where,
        rule: 'action-dropped',
        detail: `removed \`${parsed.name}\`: ${disposition.why}`,
      });
    }
  }
};

// --- where the registry and the helpers live ----------------------------------

/** What a job or composite that this port also generates is called, by the name GitHub knows it. */
export interface PortedPaths {
  /** Local composite actions that are generated too: `setup-turbo`. */
  readonly composites: readonly string[];
  /** Repository files copied with the same text edits: `.github/scripts/pull-ci-images.sh`. */
  readonly scripts: readonly string[];
}

const GITHUB_ACTIONS_DIR = './.github/actions/';
const FORGEJO_ACTIONS_DIR = './.forgejo/actions/';

/**
 * A local composite action that is generated for Forgejo too is used from its
 * Forgejo copy; one that is not ported is flagged where it is still used.
 */
export function rewriteLocalActions(paths: PortedPaths): Rule {
  return (doc, context) => {
    const { file, report } = context;
    for (const { at, steps } of stepLists(doc)) {
      for (const [index, step] of steps.items.entries()) {
        const uses = usesOf(step);
        if (
          !isMap(step) ||
          uses === undefined ||
          !uses.startsWith(GITHUB_ACTIONS_DIR)
        )
          continue;
        const name = uses.slice(GITHUB_ACTIONS_DIR.length).replace(/\/$/, '');
        const where = `${at}.steps[${index}]`;
        if (paths.composites.includes(name)) {
          step.set('uses', `${FORGEJO_ACTIONS_DIR}${name}`);
          report.changes.push({
            file,
            at: where,
            rule: 'local-action',
            detail: `\`${uses}\` is generated for Forgejo as \`${FORGEJO_ACTIONS_DIR}${name}\``,
          });
        } else {
          report.warnings.push({
            file,
            at: where,
            rule: 'local-action-unported',
            detail: `\`${uses}\` is not ported: it is GitHub-only`,
          });
        }
      }
    }
  };
}

/** Replace a text in every scalar string of a document; returns how many strings changed. */
export function replaceText(doc: Document, from: string, to: string): number {
  let count = 0;
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && node.value.includes(from)) {
        node.value = node.value.replaceAll(from, to);
        count += 1;
      }
    },
  });
  return count;
}

export interface Registry {
  /** The registry that holds CI images on Forgejo: `git.tale.dev`. */
  readonly host: string;
  /** The secret that holds the package token of the CI user. */
  readonly tokenSecret: string;
}

const GITHUB_REGISTRY = 'ghcr.io';

/**
 * CI images are pushed to and pulled from Forgejo's registry, with the token of a
 * user who may write packages: the job's own token can log in but not push.
 */
export function registryLogin(registry: Registry): Rule {
  return (doc, context) => {
    const { file, report } = context;
    for (const { at, steps } of stepLists(doc)) {
      for (const [index, step] of steps.items.entries()) {
        if (!usesOf(step)?.startsWith('docker/login-action@') || !isMap(step))
          continue;
        const inputs = step.get('with');
        if (!isMap(inputs)) continue;
        const target = stringOf(inputs.get('registry'));
        if (
          target === undefined ||
          !(target.includes('env.REGISTRY') || target === GITHUB_REGISTRY)
        )
          continue;
        inputs.set('password', `\${{ secrets.${registry.tokenSecret} }}`);
        report.changes.push({
          file,
          at: `${at}.steps[${index}]`,
          rule: 'registry-login',
          detail: `logs in with \`secrets.${registry.tokenSecret}\`: the job token cannot push packages`,
        });
      }
    }
    const env =
      doc.contents instanceof YAMLMap ? doc.contents.get('env') : undefined;
    if (
      env instanceof YAMLMap &&
      stringOf(env.get('REGISTRY')) === GITHUB_REGISTRY
    ) {
      env.set('REGISTRY', registry.host);
      report.changes.push({
        file,
        at: 'env.REGISTRY',
        rule: 'registry-host',
        detail: `\`${GITHUB_REGISTRY}\` is \`${registry.host}\``,
      });
    }
  };
}
