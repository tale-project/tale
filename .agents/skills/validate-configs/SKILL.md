---
name: validate-configs
description: Use when you touch Tale file-based org config or its guards — builtin-configs/, e2e fixture config trees, CONFIG_DOMAINS, Zod schemas under lib/shared/schemas/, app bundles under builtin-configs/apps/, or a red builtin-configs, builtin-apps, email-parity, fixture-drift, or migrations:check gate. Owns which gate proves what, validator registration, enforcement postures, and the snapshot-vs-migration ritual. Run the matching gate before shipping; never duplicate a shape a shared schema already owns. For tests use test-code; for failing behaviour use fix-bug.
---

# validate-configs

Per-org configuration is JSON files under `$TALE_CONFIG_DIR/<org>/<domain>/`, seeded from the
[`builtin-configs/`](../../../builtin-configs/) catalog and validated by **one shared Zod schema per
domain** in [`lib/shared/schemas/`](../../../services/platform/lib/shared/schemas/). This skill owns
running and extending those guards. Editing a skill bundle's _content_ is
[`author-skill`](../author-skill/SKILL.md); writing tests generically is
[`test-code`](../test-code/SKILL.md).

## When this applies

- Editing or adding any file under [`builtin-configs/`](../../../builtin-configs/) or the fixture
  org trees `services/platform/tests/e2e/fixtures/config/{default,qa-guides-org}/`.
- Adding a domain to `CONFIG_DOMAINS`
  ([`lib/shared/config/registry.ts`](../../../services/platform/lib/shared/config/registry.ts)) or
  editing any schema under `lib/shared/schemas/`.
- Authoring or refreshing an app bundle under `builtin-configs/apps/<slug>/`.
- A red gate — the universal suite, `builtin_apps`, `email_bundle_parity`, `fixture_bundle_drift`,
  or `migrations:check`.

## The gates — run what you changed

All vitest gates run from `services/platform/`; `migrations:check` from the repo root.

| You changed…                                          | Run                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| catalog / fixture JSON in any non-`apps` domain       | `bunx vitest --run --project server lib/shared/config/builtin_configs_validation.test.ts`                                                                                            |
| an app bundle (manifest, views, messages, wf, agents) | `bunx vitest --run --project server convex/workflow_engine/helpers/validation/builtin_apps.test.ts convex/apps/email_bundle_parity.test.ts convex/apps/fixture_bundle_drift.test.ts` |
| any schema under `lib/shared/schemas/`                | `bun run --filter @tale/platform migrations:check`                                                                                                                                   |

The universal suite is registry-driven — it walks every `CONFIG_DOMAINS` domain over
`builtin-configs/` **plus both fixture org trees** with the same schemas the platform load path
uses. Its header doc carries the walker details; read it before touching it.

The same walk also runs as `bun run --filter @tale/platform configs:validate` (plain Bun, no
vitest) — wired into the platform `build` script and a CI step in `build.yml` so a broken builtin
catalog fails the image build, not just the test job — and, non-fatally, post-deploy via the
`validateBuiltinCatalog` internal action (`convex/lib/config_store/validate_builtin_catalog.ts`),
which walks the deployed `$TALE_CONFIG_BUILTIN_DIR` and logs any issue loudly without blocking boot.

## The rules

- **One schema, every consumer.** The loader (`convex/<domain>/file_utils.ts`), the write/publish
  path, and the CI gate all import the domain's schema from `lib/shared/schemas/` — a hand-rolled
  twin drifts silently and validates nothing (`reviewer-caught`; inside the gates it's structural —
  they import the shared schemas).
- **Every domain declares a validator.** A `CONFIG_DOMAINS` entry with no `DOMAIN_VALIDATORS` entry
  fails the suite with "add a validator" — new domains cannot ship an unvalidated catalog. The
  walkers + `DOMAIN_VALIDATORS` registry live in
  [`catalog_validator.ts`](../../../services/platform/lib/shared/config/catalog_validator.ts)
  (also driving the build-time `configs:validate` gate and the post-deploy runtime check); the
  vitest suite (`builtin_configs_validation.test.ts`) is a thin wrapper over it.
- **Enforcement posture follows the path.** Publish/upload **throws** `ConvexError` codes —
  `INVALID_VIEW`, `VIEW_BINDING_NOT_ALLOWED`, `VIEW_ROLE_UNKNOWN`, `INVALID_MANIFEST` in
  [`convex/apps/bundle_parse.ts`](../../../services/platform/convex/apps/bundle_parse.ts) — so a
  broken file never reaches an org's disk. Discovery **degrades visibly** — warn+skip a bad
  manifest, surface a bad view as an `{ id, error }` repair stub, never a silent drop and never a
  failed list ([`convex/apps/file_actions.ts`](../../../services/platform/convex/apps/file_actions.ts)).
  Match the posture of the path you're on.
- **Schema change ⇒ snapshot ritual.** `migrations:check` fingerprints every schema against
  `convex/migrations/config.snapshot.json`. Data-safe growth (new optional field, widened enum,
  removed field) → refresh with `bun run --filter @tale/platform migrations:snapshot`.
  Data-incompatible (new required field, retype, narrowed enum/literal, optional→required,
  tightened constraint) → write a versioned migration under `convex/migrations/versions/` FIRST
  (enforced by `migrations:check`).
- **Fixtures track builtins byte-for-byte.** A builtin app-bundle refresh re-syncs its pinned
  copies in both fixture trees (enforced by `convex/apps/fixture_bundle_drift.test.ts` — its header
  documents the one allowed `issue-desk-qa` rename transform). The three email inbox bundles
  (`reply-outlook-emails`, `reply-gmail-emails`, `reply-imap-emails`) are one product per provider — an edit to one must
  hit all three (enforced by `convex/apps/email_bundle_parity.test.ts`).
- **Unknown-file posture matches the loaders.** Flat/tree domains are STRICT — only `*.json`
  (+ `*.secrets.json` sidecars); any other file would be invisible at runtime, so the gate rejects
  it. Bundle items (`skills/`, `integrations/<slug>/`, `apps/<slug>/`) carry arbitrary assets;
  bundle roots hold only item directories.
- **Landmine — shipped workflows validate schema-only on the file path.** About a dozen builtin
  workflows deliberately fail `validateWorkflowDefinition`'s stricter reference/port lints while
  parsing fine with `workflowJsonSchema`; the lint runs only on the agent-tool create/save
  (publish) path. Don't "fix" the builtins to pass it and don't add the lint to the file gate.
  App-**bundled** workflows DO pass full definition validation in the builtin-apps gate.

## Adding a config domain (the drift guard forces all of it)

1. Schema in `lib/shared/schemas/<domain>.ts` — the loader and the gate must share it.
2. Registry entry in `CONFIG_DOMAINS` — layout, readContext, dataModel, scaffoldKind; the list
   order is the org-scaffold seed order, keep it stable. The registry is pure (V8-importable);
   filesystem resolvers live in `convex/lib/config_store/resolvers.ts` — the registry header
   explains the layering.
3. Validator entry in `DOMAIN_VALIDATORS` — reuse the walker matching the layout (`walkFlat` /
   `walkJsonTree` / `walkBundles`), or `external-gate` with `coveredBy` pointing at a dedicated
   suite (the `apps` pattern; the suite then asserts your gate files keep existing).
4. Catalog-scaffolded (`scaffoldKind` set)? Ship `builtin-configs/<domain>/` with at least one
   valid file — the catalog root asserts nonzero validated files.
5. Run `migrations:check` — a new schema module changes the fingerprint (see the snapshot ritual).

## Before you call it done

Tick every box, or N/A with a reason; an unticked box means not done.

- [ ] The gate matching each change ran green (per the table above) — output observed, not assumed.
- [ ] No consumer re-declares a shape — every new parse imports from `lib/shared/schemas/`.
- [ ] App-bundle edits — both fixture-tree copies re-synced and all three email siblings updated
      (drift + parity gates green), or N/A.
- [ ] Schema edits — snapshot refreshed (data-safe) or a versioned migration shipped
      (data-incompatible), or N/A.
- [ ] New domain — schema + registry entry + validator + builtin catalog dir all present, or N/A.
