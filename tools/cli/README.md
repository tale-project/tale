# Tale CLI

The `tale` command installs and operates Tale instances, applies reviewed platform
configuration and releases automation packs from client-owned repositories. Use
the [CLI reference](../../docs/en/self-hosted/install/cli-install.md) for complete
options and deployment specifications.

This README includes commands in the current source code. Published v0.5.70 lacks
`tale doctor` and `tale dev --stop`; check `tale --help` and `tale dev --help` before
using them.

## Choose your task

| Task | Start here |
| --- | --- |
| Check the machine before installing an instance | `tale doctor` when listed by `tale --help`; otherwise `docker info` and `docker compose version`. |
| Try Tale locally | [Quickstart](../../docs/en/self-hosted/install/quickstart.md): `tale init`, then `tale dev`. |
| Deploy a workspace | `tale deploy`; use `tale status` to inspect the result. |
| Upgrade an existing workspace | [Upgrades](../../docs/en/self-hosted/operate/upgrades.md): `tale update`, then `tale deploy`. |
| Deploy exact reviewed sources | `tale deploy prepare`, `verify-bundle`, then `deploy --bundle`. |
| Change native organization settings | `tale config validate`, `plan`, `apply`, then `read`. |
| Release an automation pack | [Configuration releases](../../docs/en/self-hosted/configuration/config-releases.md). |
| Recover stored state | [Backups and restore](../../docs/en/self-hosted/operate/backups-and-restore.md). |
| Run an organization's sandboxes on this machine | [Sandbox devices](../../docs/en/platform/admin/sandbox-devices.md): the command from **Settings > Sandboxes > Add device**. |

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

## Start and stop a local instance

The release binary needs no Bun installation or repository checkout. Have Docker
with Compose ready, then create the project in the directory where you want to
keep its configuration:

```bash
tale init my-project
cd my-project
tale dev
```

Open the printed URL, create the owner account and organization, then connect a
credential under **Settings > AI providers**. Verify a finished reply with
[Send your first message](../../docs/en/get-started/quickstart.md).

`Ctrl-C` stops the foreground run. Run `tale dev` from the same directory to
resume. If `tale dev --help` lists `--stop`, you can start in the background with
`tale dev --detach` and stop with `tale dev --stop`, preserving the data. Otherwise,
keep the foreground run. The production deployment uses separate data volumes and
does not import the local instance's data.

When available, `doctor` checks Docker, Compose, daemon architecture and local port availability
without installing dependencies or changing files. Use `tale doctor --port 8443`
when selecting another HTTPS port, or `tale doctor --json` for structured output.
Its warnings include limitations such as ARM64 emulation; a successful check is
not evidence that image pulls or model requests will succeed. Remote Docker
contexts skip local port checks.

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

After a completed rollout, `tale --json deploy accept --bundle
"$TALE_DEPLOY_BUNDLE" --cli-ref "$TALE_CLI_COMMIT" --deployment-ref "$DEPLOYMENT_COMMIT"
--expected-version "$TALE_RELEASE_VERSION"` collects current read-only acceptance.
It verifies the exact Ready receipt, runtime image custody and OCI release labels,
the declared origin's serving version, and complete SQL/TypeScript migration
inventories from the runtime source. It refuses older bundles without that
inventory, pending operations, missing or extra ledger entries, and changed
container identities. No application or configuration state is written. The
existing deployment lock is held for the bounded observation; repeat the command
when fresh evidence is needed. `sourceTag` is image-reference metadata and may
be a source SHA tag; OCI labels and the health response establish the version.

Managed runtime error reporting defaults `SENTRY_ENVIRONMENT` to the deployment's
retained `name`. To use a canonical reporting label, declare
`"environment": { "SENTRY_ENVIRONMENT": { "env": "TALE_REPORTING_ENVIRONMENT" } }`
and supply that variable at the destination, for example `example-pr`. The label
must start with a lowercase letter or digit and contain 1–64 lowercase letters,
digits or hyphens. Browser, backend and sandbox events use it; deployment identity,
Compose ownership, state paths and stored credentials keep their existing values.

The managed proxy blocks public account and organization creation. It also serves
`GET /api/app/organizations/capabilities` with `canCreate: false`, so the app hides
organization creation and directs users to the operator. Existing deployments need
a newly prepared and applied runtime bundle to gain this capability response;
updating the platform image alone does not change their retained proxy policy.

### Apply instruction and workflow changes without a rollout

After a full deployment using a CLI and platform revision that support managed
instruction and automation resources, prepare a new reviewed bundle and apply it
with `tale deploy --bundle "$TALE_DEPLOY_BUNDLE" --configuration-only --yes --json`.
Add `--dry-run` first to verify the runtime prerequisites without applying changes.

This mode requires a completed deployment receipt that records its exact runtime
and identity basis, the same healthy running containers and images, and no pending
runtime rollout. Only native `configuration` may change; changing identity, runtime,
pack sources or other deployment inputs requires a full deployment. An older receipt
without this capability proof must first complete one normal deployment with the
updated CLI. A refusal never falls back to a full deployment automatically.

The CLI reuses its existing deployment lock, private native provisioning session,
configuration plan, journal and readback. It changes only managed instruction and
automation resources; every declared branding, governance, provider, embedding or
instance setting must already be unchanged. A retained pending plan that changed
one of those resources must finish through the full lane, including when its write
landed before the reply was lost. Existing operator and organization IDs are checked;
this mode does not bootstrap accounts or reconcile clients or SSO.

The apply takes no snapshot, pauses no containers and performs no Compose rollout
or restart. It preserves `deployment-ready.json` and writes a separate
`configuration-ready.json` only after native readback and a second runtime identity
check. A failed apply retains the native journal for exact-plan recovery. Its receipt
proves the configuration phase, not a new full runtime deployment.

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

### Rename the deploy operator's address

A managed deployment signs in as its `identity` operator on every run. To give
that account a machine address, set `identity.email` to the new address and
declare `identity.migrateEmailFrom` with the exact previous one. Keep
`bootstrap: "fresh"` and the account's password. The user ID stays, and with it
the managed clients, operator-owned skills, API keys and retained journals.

The CLI reads the retained account's current address inside the backend, signs in
with it and proves the retained user ID. It journals the change, renames the
account through the native adapter, guarded by the previous address, ends every
session the account holds and signs in again with the new address. A declared
email attestation then verifies the new address. A replay after an interruption
completes the journals without a second rename. Another account holding the new
address, a retained account holding neither, or a single sign-on link on the
operator account stops the deployment first. See
[operator address migration](../../docs/en/self-hosted/install/cli-install.md#managed-operator-address-migration).

### Declare a break-glass administrator

`identity.breakGlass: { "email": …, "passwordHash": { "env": … } }` keeps one
administrator for when the deploy operator is unavailable. Only a Better Auth hash
reaches the deployment; `tale auth hash-password` prints one from stdin or a hidden
prompt and refuses a password that fails the platform's default policy. Every
deployment creates the account, binding its ID in a retained journal as soon as
it exists, or sets the bound account back to exactly the declared credential,
ending its sessions whenever that changes (also when finishing an interrupted
run). An account at the address that the deployment did not create is refused.
The account becomes an `admin` of the managed organization through the native
member endpoints, never touching an `owner`. The deployment never signs in as
this account and records no password-change time, so an organization rotation
policy may ask it for a new password that the next deployment sets back.

A managed deployment signs in with the operator's password alone. Under an
enforced `two_factor_policy`, keep the operator on a passkey and never an
authenticator app: the CLI stops at a TOTP challenge or at an enrolment wall after
the grace period, and names which one it met.

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

### Name who may create organizations

A managed deployment refuses organization creation at its proxy for everyone.
Declare `organizations.creators` — 1 to 64 distinct sign-in addresses, literal or
environment references that preparation resolves — and the CLI writes them to the
managed `TALE_ORGANIZATION_CREATORS` runtime variable, drops the proxy refusal and
leaves the backend to judge each caller: listed addresses may create, everyone
else gets `403 ORGANIZATION_CREATION_FORBIDDEN`, and the app shows **Create
organization** only to them. The managed organization is created during bootstrap,
and a deployment's first organization is always allowed. Removing the declaration
restores the refusal and removes the variable; an `environment` entry cannot set
it. See the [organization-creators guide](../../docs/en/self-hosted/install/cli-install.md#managed-organization-creators).

## Apply native configuration

`config validate`, `plan`, `apply` and `read` use the same native configuration
engine as managed deployments. Supported declarations include branding, governance,
providers, environment credential metadata, embeddings, deployment settings, project
and agent instructions, agent tool grants, standing-task descriptions and native automation definitions,
deployments and schedules.

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

### Adopt instructions and recurring workflows

Native resource kinds `project-instructions`, `agent-instructions` and
`task-instructions` name existing `projectId`, `agentId` or `taskId` values explicitly.
They change only `instructions` or the task's `description`. They do not provision a
new fleet, replace agent equipment, select models, grant secrets, assign tasks or
change task status. Project and task text retain whitespace; agent instructions use
the native writer's trimming rule. Each text field is limited to 20,000 UTF-16 code
units. The native route checks the previous field hash atomically and retains its
audit and permission rules.

An `agent-tools` resource adopts an existing `projectId` and `agentId` with a
complete desired `tools` array. Keep every existing grant you intend to retain:
the array replaces the tool set. The native catalog validates every name, removes
duplicates and orders grants consistently before hashing. Unknown names fail;
they are never silently removed. For example, this declaration equips one
existing reviewer with task lookup and independent review:

```json
{
  "schemaVersion": 1,
  "resources": [
    {
      "kind": "agent-tools",
      "config": {
        "projectId": "11111111-1111-4111-8111-111111111111",
        "agentId": "22222222-2222-4222-8222-222222222222",
        "tools": ["task_find", "task_get", "task_review"]
      }
    }
  ]
}
```

Replace the example IDs with exact identities already read from the platform.
The caller needs editor access to the active project, and the agent must not be
managed by the platform. Members can read the narrow configuration but cannot
apply tool changes. The writer preserves instructions, model, skills, connectors
and every secret grant exactly, including unavailable equipment. An equal set
changes no timestamp or audit row; a changed set invalidates stale full-agent
saves. Plan/readback exposes only identity, tools and their native hash. A runtime
without this configuration facet or a requested capability refuses the operation.
Interrupted application uses the same pending receipt recovery described above.

An `automation-definition` resource declares `projectId`, the exact native `name`
(including folder slashes), `document`, `settings`, `presentation` and `taskContract`.
The three metadata fields are required: copy their observed native values, or use
`null` to clear them intentionally. Missing metadata is not evidence that it is empty.
Native authoring validates the document and requires passing attached tests before
saving an immutable version. An existing automation must already belong to its
declared project; a new definition binds to that existing project.

Declare an `automation-deployment` for the same name and project, with
`definitionSha256` equal to SHA-256 of the complete expanded definition configuration,
serialized as compact JSON with object keys sorted recursively. Arrays retain their
order. The CLI refuses a different digest. A schedule also requires both phases in
the same declaration. Its `automation-schedule` configuration has `projectId`,
`name`, `cron`, `timezone` and `enabled`. Application saves definitions, promotes their
exact tested versions, then reconciles schedules. Existing runs retain their version.

Equal resources are no-ops. Interrupted phases reconcile native readback before
retrying, so a lost response does not mint another version or trigger. Schedule edits
retain the existing trigger ID, firing cursors and failure accounting. Configuration
refuses to re-enable an existing disabled schedule or modify a schedule paused after
failures: investigate and recover it through the native trigger controls first, then
plan again. Automation deletion also requires explicit native recovery; a source
apply cannot resurrect a tombstoned name.

### Capture configuration from owned source files

A deployment specification may use
`"configurationSource": "autonomous-cycle/configuration.json"` instead of inline
`configuration`. The referenced JSON contains the same `schemaVersion: 1` and
`resources` envelope. Keep all existing resources in that one declaration.

Instruction values may be `{ "file": "roles/reviewer.md" }`; task descriptions use
that reference in `description`. A definition's `document` may be
`{ "file": "workflows/review.yml" }`. These paths resolve relative to the declaration
file. For example:

```json
{
  "schemaVersion": 1,
  "resources": [
    {
      "kind": "project-instructions",
      "config": {
        "projectId": "existing-project-id",
        "instructions": { "file": "policy.md" }
      }
    }
  ]
}
```

Preparation captures expanded text and parsed YAML inside the immutable bundle;
application never follows source paths. References must be owned regular files with
relative paths, no traversal or symlinks: `.md` for instructions, `.yml` or `.yaml` for
workflows. Duplicate YAML keys, invalid UTF-8, files larger than 512 KiB, more than
128 referenced files, or a total above 8 MiB are refused. There is no templating,
environment interpolation or remote fetch. Calculate definition digests from the
expanded configuration, not the file-reference objects or YAML bytes.

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

## Run sandboxes on this machine

A machine with Docker can run a Tale organization's sandboxes as a device. An
admin copies the connect command from **Settings > Sandboxes > Add device**; it
installs the CLI when needed and runs:

```bash
tale sandbox connect https://your-org.tale.dev --token tsdj_…
tale sandbox status
tale sandbox logs --follow
tale sandbox disconnect
```

`connect` trades the single-use token for the device's own credential, writes
`~/.tale/sandbox/device.json` (owner-only; `TALE_SANDBOX_HOME` moves it) and lets
the sandbox image's `device-apply` helper start the device's containers at the
server's release. The device dials out to the site, so nothing listens on the
machine, and follows server updates by itself unless connected with
`--no-auto-update`. The [device guide](../../docs/en/platform/admin/sandbox-devices.md)
and the [command reference](../../docs/en/self-hosted/install/cli-install.md#sandbox-device)
cover placement, updates and removal.

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
