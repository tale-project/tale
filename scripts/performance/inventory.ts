import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { root } from './workloads';

interface Coverage {
  workloads: string[];
  shared?: boolean;
  remaining: string;
}

/** Every shipped workspace gets an explicit lane, including infrastructure. */
const coverage: Record<string, Coverage> = {
  '@tale/shared': {
    workloads: ['shared.lines', 'shared.long-line'],
    remaining:
      'Database retry/transaction throughput needs Postgres; schemas and other utilities are not exhaustively benchmarked.',
  },
  '@tale/platform': {
    workloads: [
      'platform.schema-cold',
      'platform.schema-hot',
      'platform.telemetry-disabled',
      'platform.telemetry-enabled',
      'platform.agent-progress',
    ],
    remaining:
      'Full API/worker/DB/object-store/knowledge/agent runs need an isolated seeded stack; UI needs authenticated Playwright traces and real datasets.',
  },
  '@tale/sandbox': {
    workloads: ['sandbox.validation', 'sandbox.sse'],
    remaining:
      'Container admission, image warmup, Kubernetes/Docker provisioning and concurrent session capacity need a disposable runtime host.',
  },
  '@tale/sandbox-runtime-daemon': {
    workloads: ['daemon.exec-replay'],
    remaining:
      'Host exec/replay only; Linux subreaper, long-running reconnect load and container resource limits need the runtime image.',
  },
  '@tale/sandbox-runtime': {
    workloads: ['daemon.exec-replay'],
    shared: true,
    remaining:
      'Daemon code measured on host; runtime image, agent CLIs, document toolchain and Linux process isolation require Docker and image builds.',
  },
  '@tale/ai-gateway': {
    workloads: ['gateway.store'],
    remaining:
      'Synthetic encrypted local account store; OAuth/provider refresh latency and real credential-pool throughput require vendor credentials and a controlled test account.',
  },
  '@tale/ui': {
    workloads: ['ui.static-http', 'ui.seo-cold', 'ui.seo-hot', 'ui.render'],
    remaining:
      'Shared server and representative components only; browser layout, hydration, virtualized lists and all other controls need browser profiling.',
  },
  '@tale/marketing-ui': {
    workloads: ['ui.render'],
    remaining:
      'Representative button SSR only; page composition, animation and hydration need browser profiling.',
  },
  '@tale/web': {
    workloads: ['ui.static-http', 'ui.seo-cold', 'ui.seo-hot', 'ui.render'],
    shared: true,
    remaining:
      'Shared serving/SEO/rendering code with synthetic content; use --http against a built service and profile real page navigation, forms and builds separately.',
  },
  '@tale/docs': {
    workloads: ['ui.static-http', 'ui.seo-cold', 'ui.seo-hot'],
    shared: true,
    remaining:
      'Shared serving/SEO code with synthetic content; actual search-index/build/prerender and browser search need service-specific measurements.',
  },
  '@tale/ui-docs': {
    workloads: ['ui.static-http', 'ui.seo-cold', 'ui.seo-hot', 'ui.render'],
    shared: true,
    remaining:
      'Shared serving/SEO/rendering code with synthetic content; actual demos/build/prerender and browser navigation need service-specific measurements.',
  },
  '@tale/cli': {
    workloads: ['cli.help'],
    remaining:
      'Cold help startup only; deployment, archive, backup and object-store workloads need disposable project/runtime fixtures.',
  },
  '@tale/e2e': {
    workloads: ['e2e.config'],
    remaining:
      'Configuration construction only; browser and product performance are not inferred from the test framework.',
  },
  '@tale/lint-manual': {
    workloads: ['tools.manual-parse'],
    remaining:
      'Parser workload only; whole-repository lint wall time is separate.',
  },
  '@tale/lint-links': {
    workloads: ['tools.link-scan'],
    remaining:
      'Link extraction workload only; whole-repository lint and git history costs are separate.',
  },
  '@tale/visual-aspect-analyzer': {
    workloads: ['visual.pixels'],
    remaining:
      '1080p pixel comparison/cropping only; Chromium capture and model analysis require browser/vendor setup.',
  },
  '@tale/db': {
    workloads: [],
    remaining:
      'Postgres + ParadeDB image required: measure queries, connection contention, lock waits and indexing against a disposable seeded stack using backend:integration plus a dedicated load run.',
  },
  '@tale/proxy': {
    workloads: [],
    remaining:
      'Caddy/TLS image required: measure read-only HTTP targets through the proxy with --http and monitor the container RSS separately.',
  },
  '@tale/sandbox-egress': {
    workloads: [],
    remaining:
      'Tinyproxy/container network required: measure allowed and denied proxy throughput plus connection cleanup in an isolated sandbox network.',
  },
  '@tale/sandbox-llm-gateway': {
    workloads: [],
    remaining:
      'Bifrost image plus controlled mock vendor required: measure streaming/cancel/token-metering throughput without spending live model credits.',
  },
  '@tale/sandbox-buildkitd': {
    workloads: [],
    remaining:
      'BuildKit host required: measure cold/warm image builds, cache growth and idle resource reclamation in a disposable cache.',
  },
  '@tale/opengrep': {
    workloads: ['tools.opengrep'],
    remaining:
      'Opt-in pinned cached scanner with local rules and synthetic files only; full registry rules and repository scan remain separate. No application runtime.',
  },
  '@tale/plop': {
    workloads: ['tools.plop-scaffold'],
    remaining:
      'Fresh CLI scaffolds one TypeScript package in a disposable destination; other generator kinds and dependency installation remain separate. No application runtime.',
  },
};

export async function workspaceInventory(
  measured: ReadonlySet<string>,
  httpWorkspaces: ReadonlySet<string>,
) {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  ) as { workspaces: string[] };
  const files = new Set<string>();
  for (const pattern of manifest.workspaces) {
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: root,
    }))
      files.add(file);
  }
  const workspaces = await Promise.all(
    [...files].sort().map(async (path) => {
      const { name } = JSON.parse(
        await readFile(resolve(root, path), 'utf8'),
      ) as { name: string };
      const entry = coverage[name];
      if (!entry)
        throw new Error(
          `Performance inventory missing ${name} (${path}); classify its lane before running`,
        );
      const workloads = entry.workloads.filter((id) => measured.has(id));
      return {
        name,
        path,
        status: httpWorkspaces.has(name)
          ? 'measured-http'
          : workloads.length > 0
            ? entry.shared
              ? 'shared-library-only'
              : 'measured-hot-path'
            : 'not-measured',
        workloads,
        remaining: entry.remaining,
      };
    }),
  );
  const discovered = new Set(workspaces.map((workspace) => workspace.name));
  for (const name of Object.keys(coverage)) {
    if (!discovered.has(name))
      throw new Error(`Stale performance inventory entry: ${name}`);
  }
  for (const name of httpWorkspaces) {
    if (!discovered.has(name))
      throw new Error(`Unknown HTTP target workspace: ${name}`);
  }
  return workspaces;
}
