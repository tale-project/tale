import { existsSync } from 'node:fs';

import marketingUiPackage from './packages/marketing-ui/package.json';
import sharedPackage from './packages/shared/package.json';
import uiPackage from './packages/ui/package.json';

export default {
  // `uvx` (the uv tool runner) is invoked by the root `format`/`format:check`
  // scripts to run pinned `ruff` for Python — it's a system binary provided by
  // uv, not an npm-installed package, so knip can't resolve it.
  ignoreBinaries: ['uvx'],
  ignore: [
    // The e2e fixture org dirs beyond the tracked `default` are untracked
    // local dev state (a nested .gitignore knip doesn't honor) and can carry
    // standalone skill sources with their own tests. CI checks out none of
    // them, and knip hints an ignore pattern unused where it matches nothing —
    // so the suppression exists only where the dirs do.
    ...(existsSync(
      new URL(
        'services/platform/tests/e2e/fixtures/config/test',
        import.meta.url,
      ),
    )
      ? ['services/platform/tests/e2e/fixtures/config/**']
      : []),
    'tools/plop/templates/**',
    // Maintenance script run by hand (`bun tools/opengrep/vendor-rules.ts`) to
    // refresh the pinned registry snapshot — never imported, not a workspace.
    'tools/opengrep/vendor-rules.ts',
    // Hand-run QA helper (`bun services/platform/tests/manual/scripts/save-auth-state.ts`,
    // see services/platform/tests/manual/setup.md) that mints a Playwright
    // storageState — never imported; reuses the platform e2e auth helpers.
    'services/platform/tests/manual/scripts/**',
    // runnerd wire-protocol contract. `runnerd-protocol.ts` is the canonical
    // source of truth; `daemon/src/protocol.ts` is a hand-kept byte-mirror (the
    // daemon is bundled into the runtime image and cannot import across the
    // service boundary). Each side consumes a different subset of the shared
    // contract, so knip would see the members used only by the *other* side as
    // dead — but they are the cross-service contract and must stay in sync.
    // The canonical copy is an explicit public-contract entry below, and
    // runnerd-protocol.test.ts pins both copies equal. Namespace enumeration
    // in that test alone cannot describe every cross-service consumer to Knip.
    // The mirror stays excluded so its spawner-only members are not dead.
    'services/sandbox-runtime/daemon/src/protocol.ts',
    // Written by `optimize-images` for future responsive marketing assets;
    // empty until sources land, but the generator always emits the file.
    'services/web/app/generated/image-manifest.ts',
  ],
  // A type used only by its own module's exported signatures (a function that
  // RETURNS an exported interface) is API shape, not dead code — flag only
  // types nothing references at all.
  ignoreExportsUsedInFile: { interface: true, type: true },
  workspaces: {
    '.': {
      // The performance runner launches this worker by path in a fresh process.
      entry: ['scripts/performance/worker.ts'],
    },
    'services/platform': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        // Frontend modules are reached through the SPA/routes and the
        // Vite/Vitest/Storybook plugins. Making their whole directories
        // entries hides orphan files and unused exports.
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // Bun production server — invoked by docker-entrypoint.sh, not from
        // package.json scripts, so knip can't auto-detect it via the npm plugin.
        'server.ts',
        // Mock gateway (folded in from @tale/mocks): the `start` entry is
        // launched by playwright's webServer (`bun lib/mocks/start.ts`), not
        // imported, so knip can't auto-detect it. It anchors gateway/registry.
        'lib/mocks/start.ts',
        // The node-vm CodeRunner's evaluation loop: `runners/node-vm.ts` forks
        // it as a child process (a heap-capped fault boundary), so nothing
        // imports it.
        'lib/engine/runners/node-vm-child.ts',
        // Data migrations: the boot migrator imports each numbered `.ts` file
        // by the name it reads from the directory (`backend/db/migrate.ts`),
        // so nothing imports them statically.
        'backend/db/migrations/*.ts',
        // Playwright specs. The config now builds via the shared
        // `createPlaywrightConfig` factory (@tale/e2e), so knip's playwright
        // plugin can't statically read testDir/testMatch — declare them here.
        // (No auth `setup` project: specs bootstrap auth via the worker-scoped
        // `org` fixture / `.auth` storage states, not a `*.setup.ts` project.)
        'tests/e2e/specs/**/*.spec.ts',
        // Container/integration suites (moved from the old @tale/container-tests
        // workspace) — invoked as `bun tests/integration/<name>.ts`, not imported.
        // `connector/lib/**` + `static-site-test.ts` are reached via their graph.
        'tests/integration/container-*.ts',
        'tests/integration/master-e2e-test.ts',
        // Docs screenshot capture runner — invoked as the root `docs:screenshots`
        // script (`bun services/platform/tests/docs-screenshots/capture.ts`,
        // hosted at root like docker:test* — a platform-local `bun tests/…`
        // script crashes knip's script parser), never imported.
        'tests/docs-screenshots/capture.ts',
        // Same shape: the docs video producer behind the root `docs:videos`
        // script (source of every services/docs/public/videos/ asset). Episode
        // specs and choreographies are auto-discovered via dynamic imports
        // (lib/episodes.ts) the graph can't see.
        'tests/docs-videos/produce.ts',
        'tests/docs-videos/episodes/*/episode.ts',
        'tests/docs-videos/episodes/*/scenes.ts',
        // Hand-run locale-org bootstrap (`bun tests/docs-videos/seed-locale-orgs.ts`).
        'tests/docs-videos/seed-locale-orgs.ts',
        // Same shape: the root `readme:assets` script derives the README gallery
        // tiles and tour from the captured docs frames.
        'tests/docs-screenshots/readme-assets.ts',
      ],
      project: ['**/*.{ts,tsx}'],
      ignore: [
        // The docs-demo E2E fixture tree is symlinks into configs/platform/custom
        // (real skill/agent/automation sources with their own tests). Following
        // them would read those files as platform project files.
        'tests/e2e/fixtures/config/**',
      ],
      ignoreDependencies: [
        // Listed in `optimizeDeps.include` in vite.config.ts as string literals so vite prebundles them;
        // consumed transitively via @tale/ui markdown source, never imported by name from platform code.
        'rehype-katex',
        'rehype-raw',
        'rehype-sanitize',
        'remark-math',
        // Peer of @vitest/browser-playwright, required at runtime by vitest's browser test mode
        // but never imported directly.
        '@vitest/browser',
        // Imported only by the on-demand CLS proof harness (scripts/cls-harness.ts),
        // which is NOT part of CI. Available transitively via @vitest/browser's
        // playwright driver, so it never needs to be a declared dependency.
        'playwright',
      ],
    },
    'services/web': {
      vite: { config: ['vite.config.ts'] },
      storybook: {
        config: ['.storybook/main.ts'],
        entry: [
          '.storybook/{main,manager,preview}.{ts,tsx}',
          '**/*.stories.{ts,tsx}',
        ],
      },
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // SSR build target — passed to `vite build --ssr` in package.json scripts;
        // vite's plugin only sees the client-side index.html input.
        'app/entry-server.tsx',
        // Playwright specs (config builds via the shared @tale/e2e factory, so
        // knip's playwright plugin can't trace testDir/testMatch).
        'tests/e2e/specs/**/*.spec.ts',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    'services/sandbox': {
      // Standalone Bun HTTP service. `src/server.ts` is the runtime entry,
      // auto-detected from `dev`/`start` scripts; tests anchor the dead-code
      // sweep for unit-only helpers. `src/devices/apply-cli.ts` is the
      // image's `device-apply` helper, dispatched by entrypoint.sh.
      entry: [
        'src/**/*.test.ts',
        'src/devices/apply-cli.ts',
        // Public wire contract shared with the separately bundled runnerd.
        'src/session/runnerd-protocol.ts',
      ],
      project: ['src/**/*.ts'],
    },
    'services/sandbox-runtime/daemon': {
      // Bundled for Node and launched by entrypoint.sh; the transport fixture
      // is bundled by its Bun test and runs in a separate Node process.
      entry: [
        'src/main.ts',
        'src/**/*.test.ts',
        'src/lazy-docker-entry.ts',
        'src/lazy-docker.node-fixture.ts',
        'src/lazy-docker-health.node-fixture.ts',
      ],
    },
    'configs/platform/custom/skills/visual-aspect-analyzer': {
      // Self-contained Bun/TS skill bundle: a library with a public embed API
      // (src/bundle.ts + src/driver.ts), CLI entrypoints (src/analyze-cli.ts,
      // src/cli.ts), and an e2e runner (src/e2e.ts) — all run or embedded
      // externally (by the agent / the sandbox-runtime image), not reached
      // through the monorepo import graph, with co-located tests. Its source is
      // the public surface, so it anchors the dead-code sweep directly. (The
      // root-level `configs/platform/**` ignore covers the root workspace's
      // scan; this workspace declares its own files, so it stays swept.)
      entry: ['src/**/*.ts'],
      project: ['**/*.ts'],
    },
    'services/docs': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // SSR build target — passed to `vite build --ssr` in package.json scripts;
        // vite's plugin only sees the client-side index.html input.
        'app/entry-server.tsx',
        // Playwright specs (config builds via the shared @tale/e2e factory, so
        // knip's playwright plugin can't trace testDir/testMatch).
        'tests/e2e/specs/**/*.spec.ts',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    'services/ai-gateway': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        'app/routes/**/*.tsx',
        // Playwright specs (config builds via the shared @tale/e2e factory).
        'tests/e2e/specs/**/*.spec.ts',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    'services/ui-docs': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // SSR build target — passed to `vite build --ssr` in package.json scripts.
        'app/entry-server.tsx',
        // Live examples are discovered by `import.meta.glob` in the demo registry.
        'app/demos/**/*.tsx',
        // Playwright specs (config builds via the shared @tale/e2e factory).
        'tests/e2e/specs/**/*.spec.ts',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    // Source-only packages expose these paths to consumers. Derive explicit
    // relative entries from their manifests: Knip's automatic absolute-path
    // discovery can miss them in worktrees. Keep internal files in the sweep.
    'packages/shared': {
      entry: Object.values(sharedPackage.exports),
    },
    'packages/ui': {
      storybook: {
        config: ['.storybook/main.ts'],
        entry: [
          '.storybook/{main,manager,preview}.{ts,tsx}',
          '**/*.stories.{ts,tsx}',
        ],
      },
      entry: [
        ...Object.values(uiPackage.exports),
        ...Object.values(uiPackage.bin),
        // Invoked by path from service build scripts, not a published bin.
        'bin/build-client.ts',
        'src/**/*.stories.{ts,tsx}',
      ],
      // Tailwind's CSS compiler must see public stylesheet imports too.
      project: ['**/*.{ts,tsx,css}'],
      ignoreDependencies: [
        // Build helper and src/{pwa,seo/runtime}/vite-plugin.ts imports. Declared
        // as an optional peer so consumers without a vite-driven service
        // don't have to install it; knip flags optional peers that are
        // referenced, which is exactly the pattern we want here.
        'vite',
        // Same shape for the shared Storybook config (src/storybook/*): the
        // addons are optional peers a consumer installs only when it runs
        // Storybook, yet the config module references them by name.
        '@storybook/addon-a11y',
        '@storybook/addon-docs',
        '@storybook/addon-themes',
      ],
    },
    'packages/marketing-ui': {
      storybook: {
        config: ['.storybook/main.ts'],
        entry: [
          '.storybook/{main,manager,preview}.{ts,tsx}',
          '**/*.stories.{ts,tsx}',
        ],
      },
      entry: [
        ...Object.values(marketingUiPackage.exports),
        'src/**/*.stories.{ts,tsx}',
      ],
      project: ['**/*.{ts,tsx,css}'],
    },
    'tools/cli': {
      // The scan job invokes this from an isolated workflow checkout, whose
      // prefix is not its actual source path in Knip's workspace graph.
      entry: [
        'scripts/check-sbom-hashes.ts',
        'scripts/check-deployment-acceptance.ts',
      ],
      project: ['**/*.ts'],
      // The embedded native workflow validator imports Ajv from platform
      // source. A CLI-only filtered install must provide that runtime edge,
      // even though this workspace does not import the package directly.
      ignoreDependencies: ['ajv'],
    },
    'tools/plop': {
      entry: ['generators/**/*.ts', 'helpers/**/*.ts'],
      project: ['**/*.ts', '!templates/**'],
    },
  },
  exclude: ['duplicates'],
};
