/**
 * BuildKit's layer cache on Forgejo.
 *
 * GitHub's `type=gha` cache talks to the runner's cache service; on Forgejo that
 * service is per instance (the instance is deleted with its job) and the exporter
 * reaches out to api.github.com for the cache's bookkeeping. The cache that works
 * is a registry cache in Forgejo's own registry. The build job already reads one
 * (`...-buildcache:amd64`, which release.yml writes); here the build job also
 * writes it, for a push to main only, as it writes GitHub's: a pull request never
 * writes a cache another run reads.
 *
 * The site images (web, docs, ui-docs) and the database image the integration job
 * builds have no registry login before their cache step, which a registry cache
 * needs, so they build without a layer cache. A login step before the cache would
 * give them one.
 */

import { isMap, isScalar } from 'yaml';
import type { YAMLMap } from 'yaml';

import type { Rule } from './context';
import { stepLists, stringOf } from './workflow';

const GHA = 'type=gha';

/** `cache-to` the build job wrote to GitHub's cache from main, as it is written today. */
const BUILD_CACHE_TO =
  /^\$\{\{\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && format\('type=gha,scope=\{0\},mode=max,ghtoken=\{1\},repository=\{2\}', matrix\.service, secrets\.GITHUB_TOKEN, github\.repository\) \|\| ''\s*\}\}$/;

const REGISTRY_CACHE_TO =
  "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('type=registry,ref={0}/{1}/tale-{2}-buildcache:amd64,mode=max,ignore-error=true,compression=zstd', env.REGISTRY, github.repository, matrix.service) || '' }}";

const CACHE_KEYS = ['cache-from', 'cache-to', 'set'] as const;

/** Lines of a scalar that do not mention the GitHub cache; `undefined` when none are left. */
function withoutGha(text: string): string | undefined {
  const kept = text.split('\n').filter((line) => !line.includes(GHA));
  const joined = kept.join('\n');
  return joined.trim() === ''
    ? undefined
    : joined.endsWith('\n') || !text.endsWith('\n')
      ? joined
      : `${joined}\n`;
}

export const buildCache: Rule = (doc, context) => {
  const { file, report } = context;
  for (const { at, steps } of stepLists(doc)) {
    for (const [index, step] of steps.items.entries()) {
      if (!isMap(step)) continue;
      const inputs = step.get('with');
      if (!isMap(inputs)) continue;
      for (const key of CACHE_KEYS) {
        const text = stringOf(inputs.get(key));
        if (text === undefined || !text.includes(GHA)) continue;
        const where = `${at}.steps[${index}].with.${key}`;
        if (key === 'cache-to' && BUILD_CACHE_TO.test(text.trim())) {
          setValue(inputs, key, REGISTRY_CACHE_TO);
          report.changes.push({
            file,
            at: where,
            rule: 'build-cache',
            detail:
              'the main-only GitHub cache export is a main-only registry cache export',
          });
          continue;
        }
        const left = withoutGha(text);
        if (left === undefined) inputs.delete(key);
        else setValue(inputs, key, left);
        report.changes.push({
          file,
          at: where,
          rule: 'build-cache',
          detail:
            'removed the `type=gha` cache: the runner cache is per instance',
        });
      }
    }
  }
};

/** Write a new text into an input, keeping the scalar's style (block or plain) where it has one. */
function setValue(inputs: YAMLMap, key: string, value: string): void {
  const node = inputs.get(key, true);
  if (isScalar(node)) node.value = value;
  else inputs.set(key, value);
}
