import { existsSync } from 'node:fs';

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
    // see services/platform/tests/manual/SETUP.md) that mints a Playwright
    // storageState — never imported; reuses the platform e2e auth helpers.
    'services/platform/tests/manual/scripts/**',
    // runnerd wire-protocol contract. `runnerd-protocol.ts` is the canonical
    // source of truth; `daemon/src/protocol.ts` is a hand-kept byte-mirror (the
    // daemon is bundled into the runtime image and cannot import across the
    // service boundary). Each side consumes a different subset of the shared
    // contract, so knip sees the members used only by the *other* side as dead
    // — but they are the cross-service contract and must stay in sync. Exclude
    // both from the dead-export sweep so the mirror stays complete.
    'services/sandbox/src/session/runnerd-protocol.ts',
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
    'services/platform': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // Bun production server — invoked by docker-entrypoint.sh, not from
        // package.json scripts, so knip can't auto-detect it via the npm plugin.
        'server.ts',
        // Platform-only: Convex backend (separate runtime, not reachable via the
        // SPA's import graph) and platform-specific app subtrees.
        'convex/**/*.ts',
        '!convex/_generated/**',
        '!convex/betterAuth/_generated/**',
        'app/features/**/*.{ts,tsx}',
        'app/hooks/**/*.{ts,tsx}',
        'app/components/**/*.{ts,tsx}',
        'reset-owner.ts',
        // Mock gateway (folded in from @tale/mocks): the `start` entry is
        // launched by playwright's webServer (`bun lib/mocks/start.ts`), not
        // imported, so knip can't auto-detect it. It anchors gateway/registry.
        'lib/mocks/start.ts',
        // Playwright specs. The config now builds via the shared
        // `createPlaywrightConfig` factory (@tale/e2e), so knip's playwright
        // plugin can't statically read testDir/testMatch — declare them here.
        // (No auth `setup` project: specs bootstrap auth via the worker-scoped
        // `org` fixture / `.auth` storage states, not a `*.setup.ts` project.)
        'tests/e2e/specs/**/*.spec.ts',
        // Container/integration suites (moved from the old @tale/container-tests
        // workspace) — invoked as `bun tests/integration/<name>.ts`, not imported.
        // `integration/lib/**` + `static-site-test.ts` are reached via their graph.
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
      // ----------------------------------------------------------------
      // AI-BACKEND REWRITE PARKING (PR #2857). These subsystems were rebuilt
      // with their consumers not yet wired (the agent runtime, automations
      // engine, knowledge/PII pipelines, native connector backends, the
      // parked chat capability surface). Their exports read as dead until
      // each consumer lands — parking them keeps the sweep loud for NEW dead
      // code everywhere else. Every entry is a debt line: delete it when its
      // subsystem is wired (or truly retired) and let knip re-audit it.
      // ----------------------------------------------------------------
      ignore: [
        'lib/agents/**',
        'lib/automations_builder/**',
        'lib/chat/**',
        'lib/knowledge/**',
        'lib/pii/**',
        'lib/skills/**',
        'lib/integrations/natives/**',
        // Shared contract layer: types declared for the parked consumers
        // above (schemas, platform run/render vocabulary, provider catalog
        // shapes). Same debt, same exit.
        'lib/shared/chat-errors.ts',
        'lib/shared/constants/agents.ts',
        'lib/shared/constants/usage.ts',
        'lib/shared/schemas/skills.ts',
        'lib/shared/config/registry.ts',
        'lib/shared/constants/system-message-tags.ts',
        'lib/shared/file-types.ts',
        'lib/shared/metrics-window.ts',
        'lib/shared/platform/**',
        'lib/shared/providers/attribution.ts',
        'lib/shared/providers/catalog_normalize.ts',
        'lib/shared/sandbox-workdir.ts',
        'lib/shared/schemas/agents.ts',
        'lib/shared/schemas/approvals.ts',
        'lib/shared/schemas/enterprise_sso.ts',
        'lib/shared/schemas/governance.ts',
        'lib/shared/schemas/integrations.ts',
        'lib/shared/schemas/pii.ts',
        'lib/shared/schemas/providers.ts',
        'lib/shared/text-matching/**',
        'lib/shared/video-link-markdown.ts',
        // E2E helper for the parked chat specs.
        'tests/e2e/helpers/chat.ts',
      ],
      ignoreDependencies: [
        // Listed in `optimizeDeps.include` in vite.config.ts as string literals so vite prebundles them;
        // consumed transitively via @tale/ui markdown source, never imported by name from platform code.
        'rehype-katex',
        'remark-math',
        // Peer of @vitest/browser-playwright, required at runtime by vitest's browser test mode
        // but never imported directly.
        '@vitest/browser',
        // Imported only by the on-demand CLS proof harness (scripts/cls-harness.ts),
        // which is NOT part of CI. Available transitively via @vitest/browser's
        // playwright driver, so it never needs to be a declared dependency.
        'playwright',
        // ------------------------------------------------------------
        // AI-BACKEND REWRITE PARKING (PR #2857) — dependencies of the parked
        // subsystems ignored above. Same debt ledger, same exit: delete a
        // line when its consumer wires up, or drop the dependency with it.
        // ------------------------------------------------------------
        '@ai-sdk/provider',
        '@measured/puck',
        '@modelcontextprotocol/sdk',
        '@novnc/novnc',
        '@tanstack/react-virtual',
        '@types/mailparser',
        '@types/mssql',
        '@types/mustache',
        '@types/seedrandom',
        '@types/turndown',
        'bcryptjs',
        'chokidar',
        'cron-parser',
        'diff',
        'hast-util-to-html',
        'json-diff-kit',
        'linkedom',
        'mailparser',
        'mdast-util-from-markdown',
        'mdast-util-gfm',
        'mdast-util-to-hast',
        'mermaid',
        'micromark-extension-gfm',
        'mssql',
        'mustache',
        'parse5',
        'rehype-raw',
        'rehype-sanitize',
        'seedrandom',
        'sucrase',
        'turndown',
        'undici',
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
        'vitest.ui.config.ts',
        // Playwright specs (config builds via the shared @tale/e2e factory, so
        // knip's playwright plugin can't trace testDir/testMatch).
        'tests/e2e/specs/**/*.spec.ts',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    'services/sandbox': {
      // Standalone Bun HTTP service. `src/server.ts` is the runtime entry,
      // auto-detected from `dev`/`start` scripts; tests anchor the dead-code
      // sweep for unit-only helpers.
      entry: ['src/**/*.test.ts'],
      project: ['src/**/*.ts'],
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
    'packages/ui': {
      storybook: {
        config: ['.storybook/main.ts'],
        entry: [
          '.storybook/{main,manager,preview}.{ts,tsx}',
          '**/*.stories.{ts,tsx}',
        ],
      },
      entry: ['src/components/**/*.{ts,tsx}', 'src/**/*.stories.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
      ignoreDependencies: [
        // Type-only import in src/{pwa,seo/runtime}/vite-plugin.ts. Declared
        // as an optional peer so consumers without a vite-driven service
        // don't have to install it; knip flags optional peers that are
        // referenced, which is exactly the pattern we want here.
        'vite',
      ],
    },
    'tools/cli': {
      project: ['**/*.ts'],
    },
    'tools/plop': {
      entry: ['generators/**/*.ts', 'helpers/**/*.ts'],
      project: ['**/*.ts', '!templates/**'],
    },
  },
  exclude: ['duplicates'],
};
