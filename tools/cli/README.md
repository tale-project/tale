# Tale CLI

The `tale` command installs and operates Tale instances, applies reviewed platform
configuration and releases automation packs from client-owned repositories. Use
the [CLI reference](../../docs/en/self-hosted/install/cli-install.md) for complete
options and deployment specifications.

## Choose your task

| Task | Start here |
| --- | --- |
| Try Tale locally | [Quickstart](../../docs/en/self-hosted/install/quickstart.md): `tale init`, then `tale dev`. |
| Deploy a workspace | `tale deploy`; use `tale status` to inspect the result. |
| Upgrade an existing workspace | [Upgrades](../../docs/en/self-hosted/operate/upgrades.md): `tale update`, then `tale deploy`. |
| Deploy exact reviewed sources | `tale deploy prepare`, `verify-bundle`, then `deploy --bundle`. |
| Change native organization settings | `tale config validate`, `plan`, `apply`, then `read`. |
| Release an automation pack | [Configuration releases](../../docs/en/self-hosted/configuration/config-releases.md). |
| Recover stored state | [Backups and restore](../../docs/en/self-hosted/operate/backups-and-restore.md). |
| Run project tasks with a local coding agent | `tale daemon setup`, `start` and `status`. |

## Install and inspect

Install the published binary on macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

For Windows and pinned versions, follow the
[installation guide](../../docs/en/self-hosted/install/cli-install.md). Confirm the
installed version and available commands before using a runbook:

```bash
tale --version
tale --help
tale deploy --help
tale config --help
```

The workspace instance commands align to the version recorded by `tale.json`.
Managed bundle and configuration commands use an independently pinned CLI revision
and explicit inputs. Do not assume that updating your workstation binary upgrades
running containers.

## Operate a workspace

Run these commands from the initialized project directory:

```bash
tale status
tale logs platform --tail 100
tale deploy --dry-run
tale backup
```

`status` and `logs` inspect the deployment. `deploy --dry-run` previews the change;
`backup` creates a snapshot. A backup is only useful when you have tested restoring
it with the corresponding platform version and encryption secrets.

`tale update` changes the CLI and project files, staying in the current `x.y` line
unless you select another version. `tale deploy` rolls application containers;
`--stop` also permits stop-gated updates with downtime. Blue-green rollout does not
make every operation downtime-free.

`tale rollback` is limited to a recorded compatible patch version. Recovery across
minor or major migrations uses a snapshot and its matching version; see the
[upgrade guide](../../docs/en/self-hosted/operate/upgrades.md) before crossing a
release line. The 0.5 cutover requires a fresh deployment from earlier lines.

Commands such as `reset`, `restore`, `--override` and `--override-all` change or
replace state. Read their reference and preview what is available before using
confirmation-bypass flags. They are not routine fixes for an unexplained failure.

## Deploy a reviewed bundle

Managed deployments select full source commits, a target, credentials and a pinned
CLI revision. Preparation verifies source and image provenance; application keeps
persistent deployment receipts and verifies native state.

Preparation checks configurations before it pulls runtime images. It refuses a
pack that declares fields this CLI does not know and names those fields, so pin a
CLI at least as new as the Tale your packs target.

```bash
tale deploy prepare --spec "$TALE_DEPLOY_SPEC" --output "$TALE_DEPLOY_BUNDLE" --json
tale deploy verify-bundle --bundle "$TALE_DEPLOY_BUNDLE" --cli-ref "$TALE_CLI_COMMIT" --json
tale deploy --bundle "$TALE_DEPLOY_BUNDLE" --cli-ref "$TALE_CLI_COMMIT" --dry-run --json
```

After review, applying the same bundle with `--yes` authorizes the deployment.
Prepare and apply managed bundles on Linux with a matching architecture; managed
bundle commands require POSIX custody checks and are unavailable on Windows.
Retain the bundle, source pins and receipts together. Serialize competing
deployments externally: a local lock does not coordinate separate hosts.

The managed proxy blocks public account and organization creation. It also serves
`GET /api/app/organizations/capabilities` with `canCreate: false`, so the app hides
organization creation and directs users to the operator. Existing deployments need
a newly prepared and applied runtime bundle to gain this capability response;
updating the platform image alone does not change their retained proxy policy.

### Name managed containers

Use `runtime.containerPrefix`, for example `north-desk-prod`, to give every managed
service a visible `<prefix>-<service>` name. The prefix is a lowercase hyphenated
slug of at most 40 characters. Service DNS names keep their existing meaning.

Changing or removing the prefix recreates containers and can briefly interrupt
service. Keep `name`, `composeProject` and `stateDirectory` unchanged to retain the
existing deployment, volumes, credentials and recovery records. Prepare and preview
a new bundle; after an interrupted apply, retry the exact pending bundle.

Omit the option to use source container names. Continue to run one complete managed
runtime per Docker daemon: naming does not allocate separate ports, sandbox networks
or host workspaces. The [container-naming guide](../../docs/en/self-hosted/install/cli-install.md#choose-container-names)
explains validation, identity and the transition back to source names.

Client content belongs in its own repository under `tale/`. The shared CLI owns
compilation, validation, deployment and readback; it does not contain client
business rules. Ignore `.tale/`, which holds local coordination state.

### Change a managed deployment hostname

Set the deployment’s new `origin` and declare
`identity.migrateOriginFrom: "https://old.example.org"` with the exact previous
HTTPS origin. The two origins must differ. Keep `bootstrap: "fresh"`, the same
account and organization, and the same managed client keys: this reuses a completed
managed identity, rather than creating a replacement account or rotating secrets.

The CLI authenticates the retained account and verifies the managed clients before
updating their origin bindings. Required recovery records are:

- The completed bootstrap journal.
- The completed email-attestation journal, if `emailVerification` is declared.
- Completed journals for each declared managed client.
- A ready native configuration receipt, if native configuration is declared.

Missing, pending or unrelated identity/client journals stop migration. Completed
journals at either reviewed origin allow a retry to finish an interrupted change.
Native configuration keeps the same organization ID and slug and checks every
resource through its normal plan and readback flow. An interrupted configuration
write at the new origin resumes the exact pending plan; a pending receipt at the
old origin blocks migration.

After a ready receipt, remove `migrateOriginFrom` from subsequent deployment
specifications and export consumer configuration for the new issuer. To reverse a
completed migration, explicitly swap the two origins and repeat the reviewed
bundle deployment. This operation updates retained origin bindings; it does not
move a database or replace the retained identity. See
[managed origin migration](../../docs/en/self-hosted/install/cli-install.md#managed-origin-migration)
for the complete specification and credential-export procedure.

### Serve additional origins

Declare top-level `additionalOrigins` for the other HTTPS origins the same instance
answers on: 1 to 16 distinct bare origins on the default port, or environment
references that preparation resolves. None may repeat `origin`; one may equal
`identity.migrateOriginFrom` to keep a previous hostname answering during a move.
With `tlsMode: "letsencrypt"`, local hostnames and IP addresses are refused.

The CLI writes the list to the managed `ADDITIONAL_SITE_URLS` runtime variable and
refuses it as an `environment` entry; removing the declaration and applying again
removes the variable. Native identity, client journals, the OIDC issuer, passkeys
and email links stay on `origin`. Preparation refuses a Tale revision whose proxy
cannot trust an external TLS terminator (`Runtime does not serve additional
origins`). The [additional-origins guide](../../docs/en/self-hosted/install/cli-install.md#managed-additional-origins)
covers forwarding, `TRUSTED_PROXIES` and callback registration.

## Apply native configuration

`config validate`, `plan`, `apply` and `read` use the same native configuration
engine as managed deployments. Supported declarations include branding, governance,
providers, environment credential metadata, embeddings and deployment settings.

Review the saved plan before applying it with `--plan`, `--receipt` and `--yes`.
The plan binds the destination, declaration and prior native state. Concurrent
changes are rejected; a partially applied operation can retain earlier writes and
a pending receipt. Follow the receipt’s recovery state rather than issuing an
unrelated overwrite.

If the retained plan can no longer complete, review a replacement declaration and
fresh plan with the same target and resource identities. Apply with the original
receipt and `--supersedes-pending-plan <sha256>`, using the hash of the retained
plan’s canonical JSON. The receipt preserves the previous plan and verified writes
under `superseded`; unrelated native edits block replacement before mutation.

Managed deployments use `supersedesPendingConfigurationPlan` for that same hash.
`supersedesPendingBundle` selects a pending rollout separately and does not replace
native configuration intent. Remove recovery selectors after the operation reaches
`ready`. The [recovery procedure](../../docs/en/self-hosted/install/cli-install.md#replace-a-pending-configuration-plan)
includes the hash command, review steps and readback checks.

Secret values come from environment references. The CLI does not install model
servers or migrate existing embedding vectors. Read the
[configuration examples](../../docs/en/self-hosted/install/cli-install.md#configure-the-platform)
for restart requirements, embedding preconditions and exact schemas.

## Release a configuration pack

Use `config build` and `verify --rebuild` to produce and reproduce reviewed
artifacts, `stage` to prepare transfer, and `deploy` to install through the native
API. `verify-native` reads the deployed content without importing or deploying it.
The full source commit identifies a new release; owned skill slugs include that
commit and the compiler binds their owner.

Keep the native operator session in `TALE_CONFIG_COOKIE`, never in an argument,
archive or public receipt. A stored receipt does not prove current native content;
perform readback after deployment and operational tests. The
[release guide](../../docs/en/self-hosted/configuration/config-releases.md) covers
recovery and preserved historical release formats.

## Connect a local runtime

The daemon dispatches assigned Tale tasks to installed coding-agent CLIs:

```bash
tale daemon setup
tale daemon status
tale daemon start
```

It runs work in isolated Git worktrees and reports results to the task. The local
permission ceiling limits the server’s requested permissions. Keep the daemon API
key in `TALE_DAEMON_API_KEY` when it should remain outside the configuration file;
use `TALE_DAEMON_HOME` to select a separate configuration directory.

## Build and test this workspace

From the repository root, install dependencies and generate the embedded catalog
before running the source entry point:

```bash
bun install
bun run --filter @tale/cli generate
bun tools/cli/src/index.ts --help
bun run --filter @tale/cli test
```

Compile the target you need:

```bash
bun run --filter @tale/cli build:mac
bun run --filter @tale/cli build:linux
```

These produce `tools/cli/dist/tale`; choose one target for an artifact rather than
expecting both binaries at that path. Linux x64 CPUs without AVX2 need
`build:linux-baseline`. Other target scripts are listed in `package.json`. The
complete `build` script regenerates inputs, builds the backend-local bundle and
release targets, then checks the compiled bundle.

Generated embedded files are build inputs, not hand-authored configuration. Change
the source catalog or template and regenerate them. Run the repository gate before
submitting a CLI change, and verify any changed command against an isolated
instance with appropriate state and credentials.
