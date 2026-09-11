# Tale CLI

A self-contained CLI for managing Tale instances and releasing client-owned
automation configurations.

## Features

- **Blue-green deployments** - Zero-downtime deployments with automatic rollback capability
- **Secure by default** - Only ports 80/443 exposed, all other ports are internal
- **Single binary** - Easy deployment to any server
- **Extensible** - Modular command structure for future features

## Installation

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

### From GitHub Releases

```bash
# Download latest binary
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Build from Source

```bash
cd tools/cli
bun install
bun run build:linux
# Binary at: dist/tale
```

## Usage

### Deploy Commands

```bash
# Deploy the current CLI version (blue-green, zero-downtime)
tale deploy

# Also update the stop-gated tier (db, proxy) — brief downtime
tale deploy --stop

# Deploy specific services only (in-place update)
tale deploy --services platform

# Dry run to preview changes
tale deploy --dry-run
```

For workspace deployment, the deployed version matches the running CLI's version. The CLI keeps
itself aligned to the instance automatically — instance-management commands check
the workspace's recorded version and attempt to update the binary to match. To move to a
new version, run `tale update` (updates the CLI + syncs project files), then
`tale deploy` to roll the containers.

### Managed Deployment Bundles

For exact source deployments, the same CLI prepares and applies a reviewed
bundle. Client repositories own `tale/` packs and their business tests. Deployment
automation owns destination choices, full source commits and credential
references; Tale owns checkout, image verification, state adoption, snapshots,
rollout, native identity/configuration provisioning and receipts.

```bash
tale deploy prepare --spec "$TALE_DEPLOY_SPEC" --output "$TALE_DEPLOY_BUNDLE" --json
tale deploy verify-bundle --bundle "$TALE_DEPLOY_BUNDLE" --cli-ref "$TALE_CLI_COMMIT" --json
tale deploy --bundle "$TALE_DEPLOY_BUNDLE" --cli-ref "$TALE_CLI_COMMIT" --dry-run --json
tale deploy --bundle "$TALE_DEPLOY_BUNDLE" --cli-ref "$TALE_CLI_COMMIT" --yes --json
```

Prepare on Linux with a compiled CLI from a clean committed checkout, matching
the destination's architecture. Preparation verifies source and image provenance
through Git and Docker. Transfer the complete bundle and apply it on the
destination with its local Docker daemon and retained state directory. Optional
`--deployment-ref` records orchestration provenance. The Linux/macOS ARM64 composite action
`.github/actions/setup-cli` accepts the full Tale `revision`, builds with Bun
1.4.2, exposes `executable` and adds it to `PATH`; pin both the action reference
and its revision input. The [managed deployment reference](../../docs/en/self-hosted/install/cli-install.md#managed-deployments)
contains the specification and environment-reference example.

Managed bundle commands are unavailable on Windows, including `deploy verify-bundle` and backend-local `deploy provision`: their custody checks require POSIX executable modes. Run the complete managed deployment on a Linux host. Ordinary workspace commands and standalone `config build`, `verify`, `stage`, `deploy` and `verify-native` remain available on Windows.

The backend-local `deploy provision [--bundle <directory>]` phase reads bounded
private JSON on stdin, proves the selected local account/organization, deploys
the exact staged configurations and signs out. It returns only safe metadata.
It refuses workspace flags and `--dry-run`; use read-only verification first.
Exact `--cli-ref` and `--deployment-ref` expectations require `--bundle` and
are checked before native login.
Existing native client callbacks can converge without ID or secret rotation. On
maintained 0.5 backends this uses a lazy adapter loading only the fixed native
auth/SQL modules inside that backend when a change is required; both connections
close afterward. It does not expose a remote update endpoint or accept module
paths from input. Exact no-ops require no backend module loading.

Fresh native targets are explicit: `identity.bootstrap: "fresh"` permits local
account/organization creation; a configuration can use
`project: { "key": "NORTH", "name": "Configuration" }` instead of `projectId`,
and `skillOwner: "operator"` transfers verified source for compilation after
the native operator is authenticated. The host independently verifies the
owner-bound artifact. A native client chooses an existing `clientId` or
`managed: true`; managed creation records intent before writing and returns only
a private credential handoff path and SHA. Unknown acceptance holds; replay
preserves IDs and secrets. Existing explicit-ID behavior is unchanged.

Fresh-only `identity.emailVerification: "operator-attested"` records the
operator's assertion of the authenticated account's email ownership. The
short-lived native verification preserves hooks without mailbox delivery,
email changes or another session. Omit it for normal native verification;
ready-state verification drift holds. Use `deploy export-client --bundle DIR
--client KEY --output NEW_PRIVATE_DIR --env-prefix TALE_OIDC --cli-ref FULL_SHA
--deployment-ref FULL_SHA --json` for a private credential handoff. The CLI
verifies the ready deployment and emits regular `0600` JSON files under an
owned `0700` directory; its parent must already be account-owned `0700` with
trusted ancestors. Stdout exposes only safe metadata and hashes. The
optional `consumer-env.json` is a literal map whose issuer includes `/api/auth`, never a shell script or public
CI artifact. Partial/stale output holds without replacement.

Bundle deployment preserves supported existing state and verifies health; it
does not inherit the workspace path's blue-green guarantees. The ready receipt
is written only after native readback and session cleanup. Keep snapshots,
stages and receipts for recovery, and coordinate all deployers sharing a target.

### Platform configuration

`config validate`, `config plan`, `config apply` and `config read` share one
native configuration engine. A declaration selects branding, governance
policies, custom providers, environment credential metadata, embedding
configuration or instance deployment settings. Native schemas live in
`@tale/shared/schemas/*`; the platform owns authorization, persistence, audit
and domain effects. The CLI does not write arbitrary platform files.

Save and review a plan before applying it with `--plan`, `--receipt` and
`--yes`. The plan binds the exact target, declaration and native preimages.
Native compare-and-set rejects concurrent edits. A failed operation retains a
pending receipt for explicit recovery; completed earlier writes may remain.
Undeclared resources are preserved. Secret values stay in environment
variables. `read` compares the declared resources with native state.

Managed deployments use the same engine through `configuration` after
identity provisioning and before configuration releases. Their public
`native.configuration` proof binds the declaration and deployment bundle.
Managed boot-setting activation drains the verified sandbox spawner for up to
five minutes, then restarts it and verifies the new boot, mounted configuration
and health. Active sessions retain pending state. The `configurationActivation`
receipt lets an interrupted apply reconcile an accepted restart without repeating
it. Standalone boot-setting writes return `restartRequired`; native permissions,
embedding migration requirements and explicit default-credential changes
remain enforced. Model hardware and serving remain the endpoint operator’s
responsibility. Pause uploads, synchronization and crawls during embedding
changes; the CLI checks organization-wide document and website counts, but
does not lock ingestion or migrate existing vectors.

Use the worked JSON examples and command reference in
[CLI installation](../../docs/en/self-hosted/install/cli-install.md#configure-the-platform)
and the [provider reference](../../docs/en/self-hosted/configuration/providers.md).

### Management Commands

```bash
# Show current deployment status
tale status

# View service logs
tale logs platform
tale logs platform --follow
tale logs db --tail 100

# Snapshot all data volumes (also taken automatically before migrating deploys)
tale backup

# List snapshots / restore one (stack must be stopped; --stop stops it)
tale restore
tale restore <snapshot-id> --stop

# Roll back to the previous patch version (minor/major recovery = tale restore)
tale rollback

# Remove inactive (non-current) color containers
tale cleanup

# Remove ALL blue-green containers (prompts unless --force)
tale reset --force

# Also remove stateful services
tale reset --force --all
```

## Command Reference

### `tale deploy`

Without `--bundle`, deploy the current CLI version with the blue-green strategy. The deployed
platform version always matches the running CLI. To move to a different version,
use `tale update` first (updates the CLI + syncs project files), then `tale
deploy` to roll the containers.

| Option                  | Description                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--stop`                | Also update the stop-gated tier (db, proxy) — brief downtime                                                  |
| `-s, --services <list>` | Specific services to update (comma-separated)                                                                 |
| `--override`            | Overwrite container config from the host workspace (encrypted `*.secrets.json` and `.history/` are preserved) |
| `--override-all`        | Factory-reseed the builtin catalog into ALL orgs server-side; implies `--stop`                                |
| `-q, --quiet`           | Suppress container logs during deployment                                                                     |
| `-y, --yes`             | Non-interactive: auto-accept destructive confirmation prompts (e.g. `--override-all`)                         |
| `--dry-run`             | Preview deployment without making changes                                                                     |
| `--skip-backup`         | Skip the automatic pre-deploy volume snapshot (logged loudly)                                                 |
| `--host <hostname>`     | Host alias for proxy (default: `localhost` or `$HOST`)                                                        |

### `tale update`

Move the CLI and your on-disk project files to a new version. Updates the CLI
binary first, then syncs the project files to that version's templates. It does
**not** roll the containers — run `tale deploy` afterwards for that. If the file
sync fails, the CLI is rolled back to the workspace's previous version so the
binary and `tale.json` never drift apart. With no `--version`, targets the
latest release **in the current x.y release line** (a 0.3.x CLI moves to the
newest 0.3.x). Line upgrades (e.g. 0.3.x → 0.4.0) can be breaking, so they
never happen implicitly: when a newer line exists the command says so and
stays put; move lines deliberately with `--version`.

Workspace instance commands also align to the workspace version. Configuration
and managed bundle commands use their independently pinned CLI revision and explicit inputs.

| Option                | Description                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `-v, --version <ver>` | Update to this exact version instead of the in-line latest (allows downgrade and line changes) |
| `-f, --force`         | Force re-sync of locally modified project files                                                |
| `--dry-run`           | Preview the version change and file sync without modifying                                     |

### `tale status`

Show current deployment status including active color, running containers, and health.

### `tale logs <service>`

View logs from a service.

| Option                | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `-c, --color <color>` | Deployment color (blue or green)                      |
| `-f, --follow`        | Follow log output                                     |
| `--since <duration>`  | Show logs since duration (e.g., 1h, 30m)              |
| `-n, --tail <lines>`  | Number of lines to show from end                      |
| `--raw`               | Stream raw, unfiltered log output (no classification) |

### `tale backup`

Snapshot all data volumes (db-data, config-data, object-store-data,
caddy-data, caddy-config)
into the project-scoped `backups` volume. The same
snapshot is taken automatically before any deploy step that can migrate
data. Containers using a volume are paused for the seconds the tar takes so
the archive is crash-consistent.

### `tale restore`

List snapshots, or restore one into the data volumes. Restoring verifies
the sha256 sidecars first, refuses while any project container is running,
and asks for confirmation. After a restore, redeploy the version recorded
in the snapshot (`tale update --version <version>` then `tale deploy --stop`).

| Option      | Description                                      |
| ----------- | ------------------------------------------------ |
| `--stop`    | Stop running project containers before restoring |
| `-y, --yes` | Non-interactive: skip the confirmation prompt    |

### `tale rollback`

Roll back to the recorded previous version. Gated to patch-level steps
(the target must share `major.minor` with the running platform) — minor
and major upgrades can run forward-only migrations, and their recovery
path is `tale restore` plus a redeploy of the matching version.

### `tale cleanup`

Remove inactive (non-current) color containers.

### `tale reset`

Remove ALL blue-green containers.

| Option        | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `-f, --force` | Skip the confirmation prompt                                    |
| `-a, --all`   | Also remove stateful services (db, proxy, convex, sandbox tier) |
| `--dry-run`   | Preview reset without making changes                            |

### `tale config`

`tale config show` retains its local-project behavior: print the resolved project
directory and CLI version, or report no project with exit code 0. The release
commands use explicit inputs and do not align to a local `tale.json`, invoke
Docker or require a Tale source checkout beside the installed binary.

```bash
tale config --help
tale config build --help
tale config verify --help
tale config stage --help
tale config deploy --help
tale config verify-native --help
```

Keep the client's descriptor, packs, retained release catalogue and domain tests in its
own repository under `tale/`. The CLI owns the generic compiler, native validators
and importer. Deployment automation selects the exact client source commit,
runtime commit, Tale CLI revision and destination, then calls these commands.
No client business rules or private fixtures belong in the shared tool.

Ignore `.tale/` in the client repository: it holds the CLI's local coordination
database. Maintained configuration uses `tale/` without the dot.

`build --source-commit` defaults to manifest schema 4/compiler 3, with the full
source SHA as `releaseRef`. Owned skill slugs carry the complete SHA and logical
identity metadata. `verify --rebuild` requires identical archives; `stage
--config-ref` builds the exact source checkout into an external directory with a
hashed transfer inventory, without a generated catalogue commit. Explicit
`--config-version` retains the semantic catalogue compatibility path. `deploy`
requires a persistent receipt and confirmation (`--yes` for
an approved unattended run); `verify-native` reads current native content without
uploading, deploying or writing a receipt. Both native commands take
`TALE_CONFIG_COOKIE` from the environment only.

The [configuration release journey](../../docs/en/self-hosted/configuration/config-releases.md)
covers the descriptor, complete commands and recovery boundaries. The
[CLI reference](../../docs/en/self-hosted/install/cli-install.md#configuration-releases)
lists required options, optional stage-identity checks and retained-version
verification. The parser and validator bundled with a CLI support their own
native format; they do not make newer server capabilities available on an older
target. Serialize managed deployments externally and retain the exact pins and
receipts; the local lock is not a cross-host compare-and-swap guarantee.

### `tale daemon`

Run Tale board tasks on this machine with the coding-agent CLIs you already use
(**Claude Code**, **Codex**, **OpenCode**, auto-detected on PATH). Agents bound
to an external runtime get their tasks dispatched here instead of Tale's internal
LLM loop; each run executes in an isolated git worktree and reports back as a task
comment, parking the task at **In review**. Nothing is ever pushed. The effective
permission is `min(server-configured, local ceiling)` — `safe` by default.

```bash
tale daemon setup    # base URL, API key, workspace, permission ceiling
tale daemon start    # register + claim loop (Ctrl-C drains the current run)
tale daemon status   # config, detected CLIs, server connectivity
```

Any `setup` answer can be passed as a flag (`--url`, `--key`, `--name`,
`--workspace`, `--workspace-key`, `--ceiling`) to skip its prompt; add `--yes`
to run unattended. This is what the **Generate key & copy command** button under
**Settings → API → Runtimes** produces:

```bash
tale daemon setup --yes --url https://your-org.tale.dev --key <api-key>
tale daemon start
```

Config lives at `~/.tale-daemon/config.json` (chmod 600). Set
`TALE_DAEMON_API_KEY` to keep the key out of the file.

## Environment Variables

| Variable                       | Description                                                                                                                                              | Default                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `GHCR_REGISTRY`                | Container registry                                                                                                                                       | `ghcr.io/tale-project/tale` |
| `HEALTH_CHECK_TIMEOUT`         | Health check timeout (seconds)                                                                                                                           | `300`                       |
| `DRAIN_TIMEOUT`                | Connection drain timeout (seconds)                                                                                                                       | `30`                        |
| `TALE_PLATFORM_REPLICAS`       | Replicas of the web tier in a colour (1-16)                                                                                                              | `1`                         |
| `TALE_BACKEND_API_REPLICAS`    | Replicas of the api in a colour (1-16)                                                                                                                   | `1`                         |
| `TALE_BACKEND_WORKER_REPLICAS` | Replicas of the job runner in a colour (1-16)                                                                                                            | `1`                         |
| `BACKUP_KEEP_COUNT`            | Snapshots kept regardless of age                                                                                                                         | `5`                         |
| `BACKUP_KEEP_DAYS`             | Days a snapshot is kept regardless of count                                                                                                              | `14`                        |
| `HOST`                         | Host alias for proxy                                                                                                                                     | `localhost`                 |
| `TALE_DAEMON_API_KEY`          | `tale daemon` API key (keeps it out of the config file)                                                                                                  | _(unset)_                   |
| `TALE_DAEMON_HOME`             | Override the `tale daemon` config directory                                                                                                              | `~/.tale-daemon`            |
| `TALE_CONFIG_COOKIE`           | Native operator session cookie for `config deploy` and `config verify-native`; inject through a secret manager, never CLI arguments or release artifacts | _(unset)_                   |
| `TALE_SOURCE_SSH_KEY`          | Read-only private-client SSH key contents for `deploy prepare` only; never included in bundles or runtime environments                                   | _(unset)_                   |

## Architecture

### Services

**Stop-gated (only updated with `tale deploy --stop`):**

- `db` - TimescaleDB (PostgreSQL)
- `object-store` - MinIO, the bundled blob store
- `proxy` - Caddy reverse proxy

**Rolled in place on every deploy:**

- `sandbox` / `sandbox-egress` - sandbox tier (drained before rolling); a
  singleton because the spawner holds docker.sock and the session directory
- `sandbox-llm-gateway` - LLM gateway for sandbox harnesses (owns
  `llm-gateway-data`)

**Rotatable — the stateless application tier, deployed as ONE colour:**

- `platform` - the Tale app shell
- `backend-api` - every application door, auth, the hint stream
- `backend-worker` - the job runner

All three share the platform image, so they can never version-skew from each
other, and each is replicable (`TALE_*_REPLICAS`, default 1). A colour's
containers carry no pinned `container_name` — that is what lets compose
replicate them — so every lookup goes through the compose project/service
labels.

### Deployment Flow

1. Pull images for the new version
2. Migrate the config volume if it still lives under its retired name
3. Roll the stateful tier in place (drained first where it has a drain door)
4. Bring the idle colour up at the configured replica counts, and wait for
   EVERY replica to be healthy
5. Switch traffic (update the state file)
6. Drain the old colour: refuse new chat turns on that colour only, wait for
   its in-flight generations, then let the web tier's drain window elapse
7. `docker network disconnect` the old colour from the serving networks —
   after the drains, because it severs live connections
8. Stop and remove the old colour, and clear the drain flag

After successful deployment, the new version is live and the previous color's containers are cleaned up.
