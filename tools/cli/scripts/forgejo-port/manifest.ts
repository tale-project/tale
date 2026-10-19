/**
 * What the port decides about each file, in one place a reviewer can read.
 *
 * Nothing here lists a job or a step of a workflow that Tale edits every day: a
 * workflow is ported unless it is named below, and what is done to it is found by the
 * rules from what it says. This file names the few files that stay on GitHub or wait,
 * and the facts of the node the port is for.
 */

import type { Registry } from './actions';
import type { Tier } from './context';

export type Plan =
  /** Ported to `.forgejo/workflows`, with whatever its entry adds. */
  | {
      readonly kind: 'port';
      /** What a pull request owes of this workflow, where it is not what the manifest says. */
      readonly tier?: Tier;
      /** Jobs that cannot run on Forgejo even though the workflow can, with why. */
      readonly dropJobs?: readonly {
        readonly id: string;
        readonly why: string;
      }[];
      /** Events that make no sense on Forgejo even though it fires them, with why. */
      readonly dropEvents?: readonly {
        readonly name: string;
        readonly why: string;
      }[];
    }
  /** Stays on GitHub on purpose: the release lane and what only GitHub can serve. */
  | { readonly kind: 'github'; readonly why: string }
  /** Not ported yet: a follow-up with a named reason. */
  | { readonly kind: 'later'; readonly why: string };

/** A change to a workflow that stays on GitHub, made by the cut-over and by nothing before it. */
export interface GithubEdit {
  /** The file under `.github/workflows`. */
  readonly file: string;
  /** The exact text to find, once. */
  readonly find: string;
  readonly replace: string;
  readonly why: string;
}

export interface Manifest {
  /**
   * What a pull request owes: `full` is what a batch owes, so that a failure shows on the pull
   * request and not in the train; `fast` is GitHub's pull request tier. A workflow may say
   * otherwise in its own plan, so the heavy suites can move onto pull requests one at a time.
   */
  readonly tier: Tier;
  /** The registry CI images are pushed to, and the secret that holds the package token. */
  readonly registry: Registry;
  /**
   * The secret that holds a GitHub token for the calls a build makes to api.github.com (the
   * web site's release feed): the job's own token is Forgejo's and means nothing there. A name
   * may not start with FORGEJO_, GITEA_ or GITHUB_ (models/secret/secret.go).
   */
  readonly githubApiTokenSecret: string;
  /** The runner labels the pool serves: a `runs-on` outside them does not queue, it falls back to Docker. */
  readonly labels: readonly string[];
  /** Local composite actions that are generated for Forgejo too. */
  readonly composites: readonly string[];
  /** Files copied beside the workflows, with the text edits Forgejo needs. */
  readonly scripts: readonly {
    readonly from: string;
    readonly to: string;
    readonly edits: readonly {
      readonly find: string;
      readonly replace: string;
    }[];
  }[];
  /** What happens to each file of `.github/workflows`; one that is not named is ported. */
  readonly workflows: Readonly<Record<string, Plan>>;
  /** What GitHub's own copies need once Forgejo is the source. */
  readonly githubEdits: readonly GithubEdit[];
}

const RELEASE_LANE =
  'the release lane stays on GitHub: Ops binds its jobs and its runs, it builds arm64 images, signs the macOS and Windows binaries and creates the GitHub release';

export const MANIFEST: Manifest = {
  tier: 'full',
  registry: { host: 'git.tale.dev', tokenSecret: 'CI_PACKAGES_TOKEN' },
  githubApiTokenSecret: 'CI_GITHUB_TOKEN',
  labels: ['ubuntu-latest', 'ubuntu-24.04'],
  composites: ['setup-turbo'],
  scripts: [
    {
      from: '.github/scripts/pull-ci-images.sh',
      to: '.forgejo/scripts/pull-ci-images.sh',
      edits: [
        {
          find: '^ghcr\\.io/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$',
          replace:
            '^(ghcr\\.io|git\\.tale\\.dev)/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$',
        },
      ],
    },
  ],
  githubEdits: [
    {
      file: 'publish-packages.yml',
      find: '  publish:\n    name: Publish ${{ matrix.package }}\n',
      replace:
        "  publish:\n    name: Publish ${{ matrix.package }}\n    # Forgejo publishes the snapshots and its push mirror carries them to GitHub, which\n    # deletes any ref Forgejo does not hold: a snapshot made here would not stay.\n    if: vars.TALE_SOURCE != 'forgejo'\n",
      why: 'the release lane still dispatches this workflow on GitHub, and it must publish nothing once Forgejo is the source',
    },
  ],
  workflows: {
    'cli.yml': {
      kind: 'port',
      dropEvents: [
        {
          name: 'workflow_dispatch',
          why: 'it builds the binaries of a release tag, to attach them to a GitHub release; releases are made on GitHub',
        },
      ],
      dropJobs: [
        {
          id: 'release',
          why: 'its manual publication uploads to a GitHub release with `gh`; releases are made on GitHub',
        },
      ],
    },
    'release.yml': { kind: 'github', why: RELEASE_LANE },
    'release-candidate-source.yml': {
      kind: 'github',
      why: 'a reusable workflow of the candidate dispatch, which only GitHub can send',
    },
    'release-candidate-receipt.yml': {
      kind: 'github',
      why: 'a reusable workflow of the candidate dispatch, which only GitHub can send',
    },
    'scorecard.yml': {
      kind: 'github',
      why: "OpenSSF Scorecard publishes to GitHub with GitHub's OIDC identity",
    },
    'load.yml': {
      kind: 'github',
      why: 'a manual load test of the whole stack, which GitHub-hosted runners serve as they are',
    },
    'workspace-upgrade.yml': {
      kind: 'github',
      why: "it upgrades a workspace from the published releases, which it resolves through GitHub's release API and pulls from GHCR",
    },
    'sandbox-incus-e2e.yml': {
      kind: 'later',
      why: 'it builds an Incus node with a ZFS pool on the runner, which needs a runner that is a virtual machine; the pool serves system containers',
    },
    'issue-labeler.yml': {
      kind: 'later',
      why: "it labels issues with github-script and GitHub's REST API; Forgejo's labels API takes ids, not names",
    },
    'cleanup-pr-images.yml': {
      kind: 'later',
      why: "it deletes a closed pull request's image tags through GHCR's API; Forgejo's registry needs its own cleanup (a package cleanup rule of the organization, or the package API with a token)",
    },
  },
};

export function planFor(manifest: Manifest, file: string): Plan {
  return manifest.workflows[file] ?? { kind: 'port' };
}

/** What a pull request owes of a ported workflow. */
export function tierOf(manifest: Manifest, plan: Plan): Tier {
  return plan.kind === 'port' && plan.tier ? plan.tier : manifest.tier;
}
