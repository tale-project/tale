/** Whole-source profiles, not caller-provided names or overrides. Each hash binds
 * every job, condition, matrix producer and immutable action reference. Keep old
 * profiles: an obsolete group executes its own source, not today's workflow. */
export const FINISH_SOURCE = {
  '.github/workflows/checks.yml':
    'a0937203f1b3095b0d8b4cc8560eeb947b7c07a9acf5c430850fbb42fa22e497',
  '.github/actions/ci-ready/action.yml':
    '8f65cea1dd5980711da087140a68264b382ff1cb0d6347d8ef034c71ddbaf7c5',
  'tools/cli/scripts/ci-ready.ts':
    '4e4adbbcf43c835800f6eb4a92db7f0a98db7432a50e3cd320aa75312294fdf8',
} as const;
const FINISH_PATHS = [
  '.github/workflows/checks.yml',
  '.github/actions/ci-ready/action.yml',
  'tools/cli/scripts/ci-ready.ts',
] as const;
export const FINISH_WORKFLOWS = {
  Checks: '.github/workflows/checks.yml',
  CLI: '.github/workflows/cli.yml',
  Build: '.github/workflows/build.yml',
  E2E: '.github/workflows/e2e.yml',
  SAST: '.github/workflows/sast.yml',
  Security: '.github/workflows/security.yml',
  Commitlint: '.github/workflows/commitlint.yml',
} as const;
export type FinishPath =
  | (typeof FINISH_WORKFLOWS)[keyof typeof FINISH_WORKFLOWS]
  | (typeof FINISH_PATHS)[number];
export type FinishSource = Partial<Record<FinishPath, string>>;
type Matrix = {
  variable: string;
  values: readonly (string | number)[];
  /** This exact node's condition requires this single job to succeed. No
   * generic expression evaluation or always()/override inference is allowed. */
  requiresSuccess?: string;
};
export type FinishProfile = {
  workflow: keyof typeof FINISH_WORKFLOWS;
  hashes: Partial<Record<FinishPath, string>>;
  verdicts: readonly string[];
  absent: readonly string[];
  matrices: Readonly<Record<string, Matrix>>;
  legacy?: boolean;
};
const shards = {
  'test-platform-shards': { variable: 'shard', values: [1, 2] },
  'test-ui-shards': { variable: 'shard', values: [1, 2, 3, 4] },
};
const services = [
  'db',
  'platform',
  'proxy',
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  'sandbox-buildkitd',
  'sandbox-runtime',
];
const closure = {
  '.github/actions/ci-ready/action.yml':
    FINISH_SOURCE['.github/actions/ci-ready/action.yml'],
  'tools/cli/scripts/ci-ready.ts':
    'b7431aa1aa71a03dc8df35c393452b274de9f443f86b4881f86acc431dd28e63',
};
function profile(
  workflow: FinishProfile['workflow'],
  hash: string,
  matrices: FinishProfile['matrices'] = {},
): FinishProfile {
  return {
    workflow,
    hashes: { [FINISH_WORKFLOWS[workflow]]: hash, ...closure },
    verdicts:
      workflow === 'Checks' ? ['test', 'test-ui', 'ci-ready'] : ['ci-ready'],
    // These event guards are false for merge_group. Build's candidate-gate
    // is deliberately still required: its output predicate is not an event guard.
    absent:
      workflow === 'Build'
        ? ['candidate-source', 'pr-scope']
        : [
            'candidate-source',
            'candidate-gate',
            ...(['CLI', 'E2E', 'Security'].includes(workflow)
              ? ['pr-scope']
              : []),
            ...(workflow === 'CLI' ? ['release'] : []),
          ],
    matrices,
  };
}
const buildMatrices = {
  build: { variable: 'service', values: services, requiresSuccess: 'changes' },
  // The pinned merge_group producer always selects these eight services.
  'vulnerability-scan': {
    variable: 'service',
    values: services,
    requiresSuccess: 'changes',
  },
};
export const FINISH_PROFILES: readonly FinishProfile[] = [
  {
    workflow: 'Checks',
    hashes: FINISH_SOURCE,
    verdicts: ['test', 'test-ui', 'ci-ready'],
    absent: ['candidate-source', 'candidate-gate'],
    matrices: shards,
    legacy: true,
  },
  profile(
    'Checks',
    '159d83af0f550b45d4e91eb7dbdb9825be8b5b9c53379a0aa3621975f36f21ca',
    shards,
  ),
  profile(
    'CLI',
    '1d32433aa06366e94f273b89c8cc54a19f97e36be65298cd4bcd5153b8b67570',
    {
      build: {
        variable: 'platform',
        values: ['linux', 'linux-arm64', 'macos', 'macos-x64', 'windows'],
        requiresSuccess: 'prepare',
      },
    },
  ),
  // Current CLI adds the request-channel push path; the entire job graph is unchanged.
  profile(
    'CLI',
    '198109738040873a9e17e658897962c82de63cdff45546f35115db8484ae3a64',
    {
      build: {
        variable: 'platform',
        values: ['linux', 'linux-arm64', 'macos', 'macos-x64', 'windows'],
        requiresSuccess: 'prepare',
      },
    },
  ),
  profile(
    'Build',
    '61b540685f2f0c2250026e1ffab2d3e184864e1787837ce92bd688fa942f47b1',
    buildMatrices,
  ),
  // Current Build additionally selects zstd image output; graph/conditions identical.
  profile(
    'Build',
    '5eacba51efee9cd3be29d0bc5f740296f701c03efaa73da66b55ab39eead6841',
    buildMatrices,
  ),
  profile(
    'E2E',
    'f3107852e2afeb469fe123e5b8f4d0cf6cc2962501e18d7558ea4d5231bce48a',
    {
      e2e: {
        variable: 'shard',
        values: [1, 2, 3, 4],
        requiresSuccess: 'build',
      },
      // The pinned non-PR scope producer selects both static sites.
      'static-sites': {
        variable: 'service',
        values: ['web', 'docs'],
        requiresSuccess: 'scope',
      },
    },
  ),
  profile(
    'SAST',
    '7399619a671aabe29b8386985ddc7c52faf6e6a2246428267089d6b2e0824ac3',
  ),
  profile(
    'Security',
    '63e1415220f1bf5b228de826474466af8e4ed2d4d12a906e956661f1e16d721c',
  ),
  profile(
    'Commitlint',
    'f399156ada061c4ef50e93c7c4fc265f712a16526a446ba890cc95de4aeafe08',
  ),
];

export function finishPaths(name: string, path: string): readonly FinishPath[] {
  const match = Object.entries(FINISH_WORKFLOWS).find(
    ([key, value]) => key === name && value === path,
  );
  if (!match) throw new Error('No reviewed finishing profile.');
  return [match[1], FINISH_PATHS[1], FINISH_PATHS[2]];
}

export function isFinishPath(path: string): path is FinishPath {
  return FINISH_PROFILES.some((entry) => Object.hasOwn(entry.hashes, path));
}
