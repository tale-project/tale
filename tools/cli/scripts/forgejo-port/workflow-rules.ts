/**
 * The rules that know a workflow or a job by name: the readiness job the merge
 * train reads, jobs and matrix rows that cannot run on the node, and the few
 * lines of a script that must say something else on Forgejo.
 *
 * Each is anchored on something Tale already holds still (a job id its readiness
 * table lists, a label the pool serves) or on one exact line it says out loud, and
 * says when that anchor is gone, so a workflow edited tomorrow is reported, not
 * carried through wrong.
 */

import { Pair, Scalar, YAMLMap, YAMLSeq, isMap, isSeq } from 'yaml';
import type { Document } from 'yaml';

import { replaceText } from './actions';
import {
  SKIPPED,
  learnRemoval,
  type EventResults,
  type PortContext,
  type Rule,
  type Tier,
} from './context';
import { flowSequence } from './triggers';
import {
  jobIds,
  jobOf,
  jobsOf,
  removeJobs,
  rootOf,
  stepLists,
  stepsOf,
  stringOf,
} from './workflow';

function literal(text: string): Scalar {
  const node = new Scalar(text);
  node.type = Scalar.BLOCK_LITERAL;
  return node;
}

/** The pull request and the batch of the merge train are the two events a verdict is given for. */
const READY_CONDITION =
  "always() && (github.event_name == 'pull_request' || github.event_name == 'push')";

const READY_STEP = 'Evaluate native workflow';

/**
 * `CI ready (X)`: the one check the merge train reads. It runs after every other job
 * whatever their result and judges them with Tale's own policy (see ready.ts): a
 * checkout of the policy and one command, where GitHub's version needs its API.
 */
export function readyJob(tier: Tier): Rule {
  return (doc, context) => {
    const job = jobOf(doc, 'ci-ready');
    const name = job && stringOf(job.get('name'));
    if (!job || name === undefined || !name.startsWith('CI ready (')) return;
    const checkout = stepsOf(job)?.items.find(
      (step) =>
        isMap(step) &&
        stringOf(step.get('uses'))?.startsWith('actions/checkout@'),
    );
    const pinned = isMap(checkout) ? checkout.get('uses', true) : undefined;
    if (!(pinned instanceof Scalar)) {
      context.report.warnings.push({
        file: context.file,
        at: 'jobs.ci-ready',
        rule: 'ready',
        detail: 'has no pinned checkout to copy: left as it is',
      });
      return;
    }
    const stem = context.file.replace(/\.ya?ml$/, '');
    const verdict = new YAMLMap();
    verdict.set('name', 'Checkout verdict policy');
    verdict.set('uses', pinned.clone());
    const withInputs = new YAMLMap();
    withInputs.set('persist-credentials', false);
    withInputs.set(
      'sparse-checkout',
      literal(
        '/tools/cli/scripts/ci-ready.ts\n/tools/cli/scripts/forgejo-port/ready.ts\n',
      ),
    );
    withInputs.set('sparse-checkout-cone-mode', false);
    verdict.set('with', withInputs);

    const evaluate = new YAMLMap();
    evaluate.set('name', READY_STEP);
    const env = new YAMLMap();
    env.set('CI_WORKFLOW', stem);
    env.set('CI_NEEDS', '${{ toJSON(needs) }}');
    env.set('CI_TIER', tier);
    env.set('CI_PORT_REMOVED', '');
    evaluate.set('env', env);
    evaluate.set('run', 'bun tools/cli/scripts/forgejo-port/ready.ts');

    const others = jobIds(doc).filter((id) => id !== 'ci-ready');
    const ready = new YAMLMap();
    ready.set('name', name);
    ready.set('needs', flowSequence(others));
    ready.set('if', READY_CONDITION);
    ready.set('runs-on', job.get('runs-on') ?? 'ubuntu-latest');
    ready.set('timeout-minutes', job.get('timeout-minutes') ?? 3);
    const steps = new YAMLSeq();
    steps.add(verdict);
    steps.add(evaluate);
    ready.set('steps', steps);
    jobsOf(doc).set('ci-ready', ready);
    context.report.changes.push({
      file: context.file,
      at: 'jobs.ci-ready',
      rule: 'ready',
      detail:
        "rewritten: one command judges the needs with Tale's readiness policy, for a pull request and for a batch alike",
    });
  };
}

/**
 * After folding: say which jobs of the GitHub workflow are gone and what each would have
 * reported, so the policy, which judges the GitHub workflow's jobs, finds them where it
 * expects them: skipped, or a scope job's success with its outputs.
 */
export const recordRemoved: Rule = (doc, context) => {
  const job = jobOf(doc, 'ci-ready');
  const steps = job && stepsOf(job);
  if (!steps) return;
  const removed: Record<string, EventResults> = {};
  for (const id of [...context.removed.keys()].toSorted())
    removed[id] = context.results.get(id) ?? {
      pull_request: SKIPPED,
      push: SKIPPED,
    };
  for (const step of steps.items) {
    if (!isMap(step) || stringOf(step.get('name')) !== READY_STEP) continue;
    const env = step.get('env');
    if (isMap(env))
      env.set(
        'CI_PORT_REMOVED',
        literal(`${JSON.stringify(removed, null, 2)}\n`),
      );
  }
};

/** A job the port leaves out for a reason it can name: the jobs that needed it see it skipped. */
export function dropJobs(jobs: readonly { id: string; why: string }[]): Rule {
  return (doc, context) => {
    for (const { id, why } of jobs) {
      if (!jobOf(doc, id)) continue;
      removeJobs(doc, [id]);
      context.removed.set(id, why);
      learnRemoval(context.knowledge, id);
      context.report.changes.push({
        file: context.file,
        at: `jobs.${id}`,
        rule: 'job-dropped',
        detail: `removed: ${why}`,
      });
    }
  };
}

/**
 * A job whose `runs-on` is a matrix key names its runner in every row. The pool serves
 * the labels it is given, and a job that names any other does not wait for one: the
 * runner falls back to a Docker image and runs it there. So a row whose runner the
 * pool does not have is a row that must not exist.
 */
export function dropForeignRows(labels: readonly string[]): Rule {
  return (doc, context) => {
    for (const id of jobIds(doc)) {
      const job = jobOf(doc, id);
      const runsOn = job && stringOf(job.get('runs-on'));
      const key = runsOn?.match(
        /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/,
      )?.[1];
      const strategy = job?.get('strategy');
      const matrix = isMap(strategy) ? strategy.get('matrix') : undefined;
      const include = isMap(matrix) ? matrix.get('include') : undefined;
      if (key === undefined || !isSeq(include)) continue;
      for (let index = include.items.length - 1; index >= 0; index -= 1) {
        const row = include.items[index];
        const runner = isMap(row) ? stringOf(row.get(key)) : undefined;
        if (runner === undefined || labels.includes(runner)) continue;
        const named = isMap(row)
          ? (stringOf(row.get('platform')) ??
            stringOf(row.get('name')) ??
            runner)
          : runner;
        include.items.splice(index, 1);
        context.report.changes.push({
          file: context.file,
          at: `jobs.${id}.strategy.matrix.include[${index}]`,
          rule: 'matrix-row',
          detail: `removed the \`${named}\` row: the pool has no \`${runner}\` runner`,
        });
      }
    }
  };
}

/**
 * A batch is a new branch, so the push has no "before" to lint from: the last commit
 * only would be linted. The commits a batch adds are the ones since it left main.
 */
export const commitlintBatch: Rule = (doc, context) => {
  if (context.file !== 'commitlint.yml') return;
  const from = 'bunx commitlint --last --verbose';
  const to =
    'bunx commitlint --from "$(git merge-base "$PUSH_SHA" origin/main)" --to "$PUSH_SHA" --verbose';
  if (replaceText(doc, from, to) === 0)
    context.report.warnings.push({
      file: context.file,
      at: 'jobs.commitlint',
      rule: 'anchor',
      detail: `the line \`${from}\` is gone: a batch's commits are no longer all linted`,
    });
  else
    context.report.changes.push({
      file: context.file,
      at: 'jobs.commitlint',
      rule: 'commitlint-batch',
      detail:
        'a push of a new branch lints every commit since main, not only the last',
    });
};

/**
 * Build's service matrix names a batch by its event, `merge_group`, to build everything for
 * it. A batch is a push here, and the only pushes the workflow has are batches.
 */
export const batchEvent: Rule = (doc, context) => {
  if (context.file !== 'build.yml') return;
  const from = '[ "$EVENT_NAME" = merge_group ]';
  const to = '[ "$EVENT_NAME" = push ]';
  if (replaceText(doc, from, to) === 0)
    context.report.warnings.push({
      file: context.file,
      at: 'jobs.changes',
      rule: 'anchor',
      detail: `the line \`${from}\` is gone: a batch may no longer build every service`,
    });
  else
    context.report.changes.push({
      file: context.file,
      at: 'jobs.changes',
      rule: 'batch-event',
      detail: 'the service matrix tells a batch by its push, not a merge group',
    });
};

/** Run URLs on Forgejo carry the run's number in the repository, not its database id. */
export const runUrls: Rule = (doc, context) => {
  const count = replaceText(
    doc,
    '/actions/runs/${{ github.run_id }}',
    '/actions/runs/${{ github.run_number }}',
  );
  if (count > 0)
    context.report.changes.push({
      file: context.file,
      at: '',
      rule: 'run-url',
      detail: `${count} run URL${count === 1 ? '' : 's'} use github.run_number: Forgejo's URLs count runs per repository`,
    });
};

/** Text a script or a workflow says about where it lives, in the places Forgejo keeps them. */
export function movePaths(
  moves: readonly { from: string; to: string }[],
): Rule {
  return (doc: Document, context: PortContext) => {
    for (const { from, to } of moves) {
      const count = replaceText(doc, from, to);
      if (count > 0)
        context.report.changes.push({
          file: context.file,
          at: '',
          rule: 'path',
          detail: `\`${from}\` is \`${to}\` in ${count} place${count === 1 ? '' : 's'}`,
        });
    }
  };
}

/**
 * The package publisher pushes `dist/*` branches and package tags to the repository it
 * runs in, with the job's token. It names GitHub as the host, and prints the spec a
 * consumer installs from, which is GitHub's whatever the repository is called here.
 */
export const publishRemote: Rule = (doc, context) => {
  if (context.file !== 'publish-packages.yml') return;
  const edits = [
    {
      from: 'https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git',
      to: 'https://x-access-token:${GITHUB_TOKEN}@${GITHUB_SERVER_URL#https://}/${GITHUB_REPOSITORY}.git',
      detail: 'pushes to the Forgejo repository it runs in',
    },
    {
      from: 'github:${GITHUB_REPOSITORY}#',
      to: 'github:tale-project/tale#',
      detail: 'prints the GitHub spec consumers install from: the mirror',
    },
  ];
  for (const edit of edits) {
    if (replaceText(doc, edit.from, edit.to) > 0)
      context.report.changes.push({
        file: context.file,
        at: 'jobs.publish',
        rule: 'publish-remote',
        detail: edit.detail,
      });
    else
      context.report.warnings.push({
        file: context.file,
        at: 'jobs.publish',
        rule: 'anchor',
        detail: `the text \`${edit.from}\` is gone: the publisher would ${edit.detail.replace('pushes', 'push').replace('prints', 'print')} wrongly`,
      });
  }
};

const ON_TAG = "startsWith(github.ref, 'refs/tags/')";

/**
 * The release lane stays on GitHub, but the tags it releases are pushed to Forgejo, so the
 * package snapshots pinned for a release are made where the tag is: Forgejo's refs are what
 * the push mirror makes GitHub's, and it deletes any ref Forgejo does not hold. A tag run
 * does what the dispatch of `release_tag` and `source_sha` does on GitHub: the tooling is
 * main's, the source is the tag's commit.
 */
export const publishOnTag: Rule = (doc, context) => {
  if (context.file !== 'publish-packages.yml') return;
  const { file, report } = context;
  const missing = (at: string, what: string): void => {
    report.warnings.push({
      file,
      at,
      rule: 'anchor',
      detail: `${what} is not as the port expects: a release tag does not pin the package snapshots`,
    });
  };

  const events = rootOf(doc).get('on');
  const push = isMap(events) ? events.get('push') : undefined;
  const job = jobOf(doc, 'publish');
  const steps = job && stepsOf(job);
  const checkout = steps?.items.find(
    (step) =>
      isMap(step) &&
      stringOf(step.get('uses'))?.startsWith('actions/checkout@') &&
      stringOf(step.get('name')) === 'Checkout',
  );
  const resolve = steps?.items.find(
    (step) => isMap(step) && stringOf(step.get('id')) === 'tag',
  );
  const env = isMap(resolve) ? resolve.get('env') : undefined;
  if (
    !isMap(push) ||
    !isMap(checkout) ||
    !isMap(env) ||
    stringOf(env.get('REF')) !== '${{ github.ref }}' ||
    stringOf(env.get('RELEASE_TAG')) !== '${{ inputs.release_tag }}' ||
    stringOf(env.get('SOURCE_SHA')) !== '${{ inputs.source_sha }}'
  ) {
    missing('on.push', 'the publisher');
    return;
  }

  const tagsKey = new Scalar('tags');
  tagsKey.commentBefore = ' A release tag pins the snapshot of its own commit.';
  push.items.push(new Pair(tagsKey, flowSequence(['v*.*.*'])));
  const inputs = checkout.get('with');
  if (isMap(inputs)) inputs.set('ref', `\${{ ${ON_TAG} && 'main' || '' }}`);
  else {
    const added = new YAMLMap();
    added.set('ref', `\${{ ${ON_TAG} && 'main' || '' }}`);
    checkout.set('with', added);
  }
  env.set('REF', `\${{ ${ON_TAG} && 'refs/heads/main' || github.ref }}`);
  env.set(
    'RELEASE_TAG',
    `\${{ inputs.release_tag || ${ON_TAG} && github.ref_name || '' }}`,
  );
  env.set(
    'SOURCE_SHA',
    `\${{ inputs.source_sha || ${ON_TAG} && github.sha || '' }}`,
  );
  report.changes.push({
    file,
    at: 'jobs.publish',
    rule: 'publish-on-tag',
    detail:
      "a release tag pushed to Forgejo pins the package snapshots, from main's tooling and the tag's commit",
  });
};

/**
 * A step that builds with turbo hands the job's token to the web site's release feed,
 * which calls api.github.com with it. The job's token on Forgejo is Forgejo's own: sent
 * to GitHub it is a bad credential, and GitHub answers a bad credential with a refusal
 * where it answers no credential with a rate limit. The feed needs a GitHub token of its own.
 */
export function githubApiToken(secret: string): Rule {
  return (doc, context) => {
    for (const { at, steps } of stepLists(doc)) {
      for (const [index, step] of steps.items.entries()) {
        if (!isMap(step) || !stringOf(step.get('run'))?.includes('turbo run'))
          continue;
        const env = step.get('env');
        if (
          !isMap(env) ||
          stringOf(env.get('GITHUB_TOKEN')) !== '${{ secrets.GITHUB_TOKEN }}'
        )
          continue;
        env.set('GITHUB_TOKEN', `\${{ secrets.${secret} }}`);
        context.report.changes.push({
          file: context.file,
          at: `${at}.steps[${index}].env.GITHUB_TOKEN`,
          rule: 'github-api-token',
          detail: `a build's release feed calls api.github.com: it takes \`secrets.${secret}\`, not Forgejo's job token`,
        });
      }
    }
  };
}

/** A workflow that names its own file in a trigger path names the Forgejo copy. */
export const ownPath: Rule = (doc, context) => {
  const from = `.github/workflows/${context.file}`;
  const count = replaceText(doc, from, `.forgejo/workflows/${context.file}`);
  if (count > 0)
    context.report.changes.push({
      file: context.file,
      at: 'on',
      rule: 'own-path',
      detail: `\`${from}\` is its Forgejo copy in ${count} place${count === 1 ? '' : 's'}`,
    });
};
