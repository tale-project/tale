---
title: Install the tale CLI
description: Install the tale CLI on macOS, Linux, or Windows — and configure it against your self-hosted instance for deploys and upgrades.
---

The `tale` CLI installs, deploys and operates Tale. Install it on the machine where you will run operator commands, then choose the [local quickstart](/self-hosted/install/quickstart) or the deployment workflow below.

The same CLI owns workspace container operations, managed deployments from exact source commits, and client configuration releases. Your deployment automation selects destination, pins and credential references, then calls the CLI. [Release client configurations](/self-hosted/configuration/config-releases) covers content from the client's own repository.

## Before you begin

You need:

- A workstation running macOS, Linux, or Windows with PowerShell.
- For local container operations: Docker with Compose and a running Docker daemon.
- For a remote workspace: access to its Docker daemon, usually through an SSH Docker context. The remote operator must be able to run Docker.

The installer downloads a release binary from GitHub. It needs access to `raw.githubusercontent.com`, `api.github.com`, `github.com` and the release download destinations that GitHub redirects to.

## Run install-cli.sh or install-cli.ps1

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

On Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

The Unix installer selects the binary for your OS and CPU. By default, it replaces an existing `tale` executable found on `PATH`, or installs into `/usr/local/bin`; it requests `sudo` only when needed to write there. The Windows installer uses `%LOCALAPPDATA%\Programs\tale` by default and updates your user `PATH`.

Release binaries cover macOS on Apple Silicon and Intel, Linux on x86_64 and arm64, and Windows x64. Windows ARM requires x64 emulation. An unsupported Unix architecture produces a build-from-source message.

Set `VERSION` to a release version to pin the install, and `INSTALL_DIR` to choose another destination. In a Unix shell, **export** these variables before running the pipeline so the `bash` process receives them; setting them only before `curl` does not pass them to the installer. In PowerShell, use `$env:VERSION` and `$env:INSTALL_DIR`.

| OS      | Installer script          |
| ------- | ------------------------- |
| macOS   | `scripts/install-cli.sh`  |
| Linux   | `scripts/install-cli.sh`  |
| Windows | `scripts/install-cli.ps1` |

## Verify

```bash
tale --version
```

The CLI prints its installed version. If the command is not found, check the destination in the installer output and ensure that directory is on `PATH`. On Windows, open a new terminal after installation. If the download fails, check the network destinations above; an optional `GITHUB_TOKEN` environment variable authenticates the release lookup when anonymous GitHub API requests are rate limited.

## Confirm configuration

For workspace container operations, use the project created by `tale init` in the [quickstart](/self-hosted/install/quickstart). The CLI walks up the directory tree to find its `tale.json`; check the selected project before operating on it:

```bash
tale config show
```

Configuration releases and [managed deployments](#managed-deployments) select their sources and destinations explicitly and do not align to a nearby workspace. `config show` keeps its existing local-project behavior.

For a workspace deployment, the host the proxy answers on, TLS settings, and every secret live in the project's `.env`. To change the host, edit `HOST` there or pass `--host` to `tale dev` / `tale deploy`. To operate a remote workspace host, point your shell's Docker context (or `DOCKER_HOST`) at it. Managed bundle deployment instead runs on its declared destination with the local Docker daemon.

## Run tale deploy

```bash
tale deploy
```

Without `--bundle`, `tale deploy` ships the CLI's own version: it pulls that version's images, restarts affected containers in order and runs schema migrations. Use `tale update` first to choose another workspace version. For independently pinned runtime and client source commits, follow [Managed deployments](#managed-deployments).

## Command reference

The CLI groups its commands by what you are doing, the same way `tale --help` does. Each command and its arguments are listed below. How to read the notation:

- A positional argument in `[square brackets]` is **optional**; one in `<angle brackets>` is **required**.
- Required options are named explicitly for configuration releases; other flags are optional unless command help marks them as required.
- A flag written `--flag <value>` **requires a value** when you use it (e.g. `--port 8443`); a bare flag like `--detach` is a boolean switch.
- **Defaults** are shown in parentheses after the description. No default means the flag is off, or the command resolves the value from `.env` / context.

Run `tale <command> --help` for the authoritative list at your installed version.

**Global flags** work on every command:

- `--verbose` — verbose output: debug logs and the raw subprocess stream (long form only; there is no `-v`).
- `-q, --quiet` — only warnings and errors.
- `-y, --yes` — assume "yes" for all prompts (non-interactive).
- `--no-color` — disable ANSI colour (also honours `NO_COLOR` / `FORCE_COLOR`).
- `--json`—machine-readable JSON on stdout; supported by `status`, every `config` subcommand and managed deployment commands.
- `--ci` — force non-interactive, append-only output (no cursor control).

Commands exit `0` on success, `2` on a usage error, `3` on an unmet precondition (no project, Docker not running, port in use), `4` on a user abort (Ctrl-C, or a required prompt with no terminal), and `5` on an external-dependency failure — so scripts can branch on the cause.

### Setup

`tale init [directory]` — create a project: it scaffolds the example configs, `AGENTS.md` + a `CLAUDE.md` pointer, and a local-default `.env` (localhost, self-signed certificate, generated secrets). No Docker is needed, and the production domain and TLS are chosen later, at `tale deploy`. In a terminal it asks for a project name when `directory` is omitted, confirms before overwriting an existing project, and asks once whether agents may run `docker` inside sandboxes (default: no — enabling it runs a privileged inner Docker); non-interactive runs skip all prompts. `directory` is optional (default: the current directory).

- `-f, --force` — overwrite an existing `tale.json` instead of aborting.
- `--no-env` — scaffold the project but skip `.env` generation.

`tale dev` — launch all services locally with a self-signed certificate.

- `-d, --detach` — run in the background instead of streaming logs.
- `-p, --port <port>` — HTTPS port to expose (default `443`).
- `--host <hostname>` — host alias for the proxy (default `localhost`).
- `-y, --yes` — non-interactive: auto-accept prompts (e.g. installing or starting Docker).

`tale deploy` — deploy the current CLI version with blue-green replacement of application roles. Shared execution services roll in place; database and proxy replacement needs `--stop`. On first deployment, the CLI asks for the production domain and TLS email unless supplied. Read [Upgrades](/self-hosted/operate/upgrades) before changing an existing installation.

- `--stop` — also update the stop-gated tier (`db`, `proxy`) — recreates those containers, so accept a brief downtime; without it, running `db`/`proxy` are left untouched.
- `-s, --services <list>` — update only these comma-separated services (default: all rotatable services).
- `--host <hostname>` — host alias for the proxy (default: the `HOST` value from `.env`).
- `--override` — overwrite container config from the host workspace (encrypted `*.secrets.json` and `.history/` are always preserved).
- `--override-all` — factory-reseed the builtin catalog into every org server-side; implies `--stop`.
- `-q, --quiet` — suppress container logs during the deploy.
- `-y, --yes` — auto-accept destructive confirmation prompts (e.g. `--override-all`).
- `--skip-backup` — skip the automatic pre-deploy volume snapshot.
- `--dry-run` — preview what would change without touching anything.

### Managed deployments

Use a reviewed deployment specification when the runtime and client configurations must follow exact source commits. Deployment automation selects the destination, credentials and pins and calls the Tale CLI. The CLI acquires source, resolves and verifies image digests, prepares the transfer, preserves supported existing state, takes recovery snapshots when required, rolls the stack, provisions the native instance and verifies configuration content. Keep those deployment internals in Tale.

#### Prepare the runtime and source pins

Run preparation with a compiled CLI built from a clean, committed Tale checkout on Linux, matching the destination's `linux/amd64` or `linux/arm64` architecture. That same executable is included for backend-local provisioning. Preparation needs Git and Docker for source/image verification; applying runs on the destination with its local Docker daemon, retained state directory and environment. The full CLI commit, runtime source commit and client configuration source commit are separate pins.

A managed deployment records its recovery point before it changes anything: the pre-deployment snapshot and the bundle being applied, kept in the state directory until the ready receipt is written. An interrupted deployment therefore expects the same bundle on retry and refuses a different one, naming the pending bundle's sha256. When that bundle can no longer complete — a corrected CLI is now pinned, say — declare the named sha256 as `supersedesPendingBundle` in the deployment specification and prepare again: the reviewed bundle takes over the same snapshot, the ready receipt lists it under `supersededBundles`, and the declaration comes out afterwards. The backend-local phases (`deploy provision`, `deploy export-client-native`) run inside the backend as its own user, the owner of its data directory, and when one fails the deploy result repeats the inner CLI's own summary.

Managed bundle commands are unavailable on Windows, including `deploy verify-bundle` and backend-local `deploy provision`: their custody checks require POSIX executable modes. Run the complete managed deployment on a Linux host. Ordinary workspace commands and standalone `config build`, `verify`, `stage`, `deploy` and `verify-native` remain available on Windows.

This synthetic specification targets an existing organization and project. Replace its public identifiers and set the named environment values. `revision` accepts a full commit SHA directly or an environment reference; credentials remain references and are resolved privately at the destination. `tlsMode: "external"` means an existing edge handles public TLS; `letsencrypt` additionally requires `tlsEmail`.

For Linux or macOS ARM64 GitHub Actions jobs, use Tale's `.github/actions/setup-cli` composite action. Pin the action itself to a full Tale commit and pass that full commit as its `revision` input. It builds with Bun 1.4.2, verifies the final executable, returns `executable` and adds the binary to `PATH`. macOS builds support general configuration preparation; managed Linux stack preparation still requires a matching Linux executable. Set `linux-baseline: 'true'` on a Linux x64 runner when the destination CPU lacks AVX2 (Intel before Haswell, for example): the default executable aborts there with `Illegal instruction`; the baseline one runs. Other runners refuse the option.

`origin` and individual native `redirectUris` can also use environment references, so a deployment registry can own public addresses. Preparation resolves them to literal validated HTTPS URLs in the bundle.

The example sets `runtime.containerPrefix` to make its environment recognizable in container listings. This optional setting is explained below.

```json
{
  "schemaVersion": 1,
  "name": "example-native",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64",
    "containerPrefix": "north-desk-prod"
  },
  "origin": { "env": "TALE_PUBLIC_ORIGIN" },
  "tlsMode": "external",
  "identity": {
    "email": { "env": "EXAMPLE_OPERATOR_EMAIL" },
    "password": { "env": "EXAMPLE_OPERATOR_PASSWORD" },
    "slug": "example-team",
    "name": "Example team",
    "ssoEnabled": false,
    "nativeClients": [
      {
        "key": "example-portal",
        "name": "Example portal",
        "clientId": { "env": "EXAMPLE_NATIVE_CLIENT_ID" },
        "redirectUris": [{ "env": "EXAMPLE_PORTAL_CALLBACK" }]
      }
    ]
  },
  "configs": [
    {
      "repository": "https://github.com/example-team/client-app",
      "revision": { "env": "EXAMPLE_CONFIG_REF" },
      "client": "example-team",
      "descriptor": "tale/client.json",
      "automation": "document-review",
      "projectId": "existing-project-id",
      "skillOwner": "native-operator-id"
    }
  ]
}
```

#### Choose container names

Set `runtime.containerPrefix` when you want names such as `north-desk-prod-db` and `north-desk-prod-backend-api` in container listings. The prefix starts with a lowercase letter and uses lowercase letters, digits and single hyphens, up to 40 characters. Spaces, underscores, repeated hyphens and a trailing hyphen are refused.

| Setting | What it identifies |
| --- | --- |
| `runtime.containerPrefix` | Visible container names: `<prefix>-<service>` for every managed service. |
| `name` and `composeProject` | The retained deployment and its Compose project, including volume ownership. |
| `stateDirectory` | The existing deployment state, credentials and recovery records. |

Keep the last two rows unchanged when renaming an existing deployment's containers. The prefix leaves service DNS names unchanged, so internal service addresses continue to use their existing names. Omit it to use the source's container naming policy.

Adding, changing or removing a prefix recreates containers and can briefly interrupt service. Prepare a new bundle, review its dry run, then apply it through the normal snapshot and recovery flow. If application is interrupted, retry that exact bundle; a pending rollout refuses a different bundle. Once the rollout is ready, removing the prefix through another prepared bundle restores the source naming policy.

Run one complete managed runtime per Docker daemon. A name prefix does not allocate separate ports, sandbox networks or host workspaces.

#### Serve additional origins {#managed-additional-origins}

Declare `additionalOrigins` when the same instance also answers on other HTTPS origins, such as a partner domain or the previous hostname during a move. Each entry is a bare HTTPS origin on the default port, or an environment reference that preparation resolves to one. List 1 to 16 distinct origins; none may repeat `origin`.

```json
{
  "origin": "https://desk.example.org",
  "additionalOrigins": [
    "https://desk.partner.example",
    { "env": "TALE_EXTRA_ORIGIN" }
  ]
}
```

The CLI writes the list to the runtime's `ADDITIONAL_SITE_URLS` and manages that variable, so an `environment` entry cannot set it. Every origin is a full entry point with its own sessions, file links, sign-in doors and connector callbacks. With `tlsMode: "letsencrypt"`, the proxy obtains a certificate for each origin, and local hostnames or IP addresses are refused. With `tlsMode: "external"`, your TLS proxy must forward each origin's original `Host` and send `X-Forwarded-Proto: https` from an address the Tale proxy trusts. When that address range is narrower than the private ranges, set `TRUSTED_PROXIES` through an `environment` reference.

The native identity stays on `origin`: account and organization bindings, client journals, the OIDC issuer, passkeys and email links use it alone. An entry may equal `identity.migrateOriginFrom` to keep the previous hostname answering while a migration completes.

Preparation refuses a runtime revision whose proxy cannot trust an external TLS terminator and reports `Runtime does not serve additional origins`. Adding, changing or removing the list recreates the services that read it. After you remove the declaration, applying the next bundle removes the variable. Register each origin's callback URLs with your identity and connector providers, and plan DNS and certificates with [TLS and domains](/self-hosted/configuration/tls-and-domains#several-domains-at-once).

#### Name who may create organizations {#managed-organization-creators}

A managed deployment refuses organization creation at its proxy for everyone: the organization picker shows no **Create organization** entry, and `POST /api/auth/organization/create` answers 403. To let named people open further workspaces, declare `organizations.creators` — 1 to 64 distinct sign-in addresses, literal or as environment references that preparation resolves.

```json
{
  "organizations": {
    "creators": ["ops@example.org", { "env": "TALE_WORKSPACE_LEAD" }]
  }
}
```

The CLI writes the list to the runtime's `TALE_ORGANIZATION_CREATORS` and manages that variable, so an `environment` entry cannot set it. With the declaration in place the proxy no longer refuses organization creation; the backend judges every caller against the list instead, answers anyone else with `403 ORGANIZATION_CREATION_FORBIDDEN`, and the app shows **Create organization** only to the people named. Addresses are matched case-insensitively, so two spellings of one address are refused as a duplicate.

The managed organization itself is unaffected: the deployment creates it during bootstrap, and a deployment's first organization is always allowed. Remove the declaration and apply the next bundle to restore the proxy refusal and remove the variable. The same variable works on a deployment you run yourself; see the [environment reference](/self-hosted/configuration/environment-reference).

#### Prepare, verify, and apply the bundle

Set `TALE_DEPLOY_SPEC` to that JSON file, `TALE_DEPLOY_BUNDLE` to a new absolute output directory, and `TALE_CLI_COMMIT` to the compiled CLI's full commit. `DEPLOYMENT_COMMIT` is optional orchestration provenance; omit its flags when unused. Prepare and verify, transfer the whole directory to the destination, then preview and apply there with the same pinned CLI.

```bash
tale --json deploy prepare \
  --spec "$TALE_DEPLOY_SPEC" \
  --deployment-ref "$DEPLOYMENT_COMMIT" \
  --output "$TALE_DEPLOY_BUNDLE"

tale --json deploy verify-bundle \
  --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"

tale --json deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT" --dry-run

tale --json --yes deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

`deploy prepare` accepts optional `--sources-file <file>` mapping `repository@fullSHA` to an existing exact checkout. Otherwise it fetches canonical GitHub repositories. Inject the read-only private-client SSH key contents through `TALE_SOURCE_SSH_KEY` only during preparation; the CLI verifies GitHub's SSH host keys over HTTPS and keeps the key out of the bundle and runtime. Registry access must already be available to Docker.

Preparation checks each configuration first, with this CLI's own schemas, and only then pulls and verifies the runtime images. It names each phase and image as it goes. A pack that declares fields this CLI does not know is refused within seconds with `native manifest normalization changes release semantics at <fields>`; prepare it with a CLI at least as new as the Tale the pack targets. A failure the CLI raises deliberately shows its own cause. Any other error keeps a fixed summary, so no credential or registry output reaches the log.

`deploy verify-bundle` checks the complete file inventory and hashes without a destination. `deploy --bundle --dry-run` checks configuration artifacts and destination preconditions without applying changes. Managed bundle deployment does not accept workspace-only overrides such as `--services`, `--host` or `--override-all`. It is a state-preserving stack rollout with health and provenance checks; the workspace blue-green behavior described above is a separate path.

#### Provision the native identity

`deploy provision [--bundle <directory>]` is the backend-local phase normally invoked by bundle deployment. It reads at most 64 KiB of private JSON from stdin, proves the local account and selected organization, and always signs out before reporting success. Its fields include `origin`, `email`, `password`, `slug`, `name`, `ssoEnabled`, optional Entra credentials, and `nativeClients`. Existing-account behavior remains the default. An explicit `identity.bootstrap: "fresh"` permits creation of the initial local account and organization. A bundle binds this choice and the staged configurations before native changes. `deploy provision` refuses workspace flags and `--dry-run`; use read-only bundle/config verification for review. Its optional `--cli-ref` and `--deployment-ref` expectations require `--bundle` and are checked before login.

For an administratively verified fresh operator, explicitly declare `identity.emailVerification: "operator-attested"`. This is an operator assertion of the authenticated account’s email ownership, not proof of mailbox delivery. The backend uses a short-lived native verification token bound to that exact account and email, retaining native hooks without sending email, changing the address or creating another session. It is permitted only with `bootstrap: "fresh"`. Omit it to retain normal native email verification. A previously ready account whose verification changes holds for review.

For a fresh target, replace a config's `projectId` with `project: { "key": "NORTH", "name": "Configuration" }`. Native project keys have 2–6 uppercase letters and names at most 80 characters. `skillOwner: "operator"` transfers a verified source capsule and compiles it for the authenticated native user inside the backend; the host independently checks the resulting artifact. Existing explicit IDs and owner-bound releases retain their exact behavior.

Each native client chooses an existing `clientId` or explicit `managed: true`. Managed creation persists its private intent before the native request, then returns only a private handoff path and SHA for client credentials. Replays preserve IDs, security policy and secrets; uncertain request acceptance without a matching native object holds. Existing clients converge only their display name and HTTPS callback URLs. On maintained 0.5 backends, necessary create/update operations use fixed backend-local auth adapters and close their connections. This enables no public registration/update route, arbitrary module path or secret rotation.

#### Change a managed deployment’s hostname {#managed-origin-migration}

Use the retained managed deployment and its private state directory. This changes the origin bindings of the existing account, organization and clients; it does not move a database or create replacement identities.

1. Set the deployment specification’s `origin` to the new HTTPS origin and `identity.migrateOriginFrom` to the exact previous HTTPS origin, for example `https://old.example.org`. The two origins must differ. Keep `identity.bootstrap: "fresh"`, the same account and organization, and the same managed client keys.
2. Check the retained state before preparing the bundle. Bootstrap must be complete. Every declared email attestation and managed client needs its matching completed journal. Missing, pending or unrelated identity/client journals block migration.
3. Prepare, verify, preview and apply the bundle through the workflow above. The CLI authenticates the retained account and verifies client credentials before updating origin bindings. Completed journals at either declared origin are accepted on retry, preserving IDs and secrets.
4. After the deployment receipt is ready, export consumer configuration for the new issuer. Remove `migrateOriginFrom` from future deployment specifications.

When native configuration is declared, its retained receipt is required too. Migration preserves the organization ID and slug and checks every resource through the normal plan and readback flow. An interrupted configuration write at the new origin resumes only its exact pending plan. A pending configuration receipt at the old origin blocks migration.

To reverse a completed migration, explicitly swap the two origins and repeat the verified deployment workflow. Plan DNS, certificates, callback registrations and access checks with [TLS and domains](/self-hosted/configuration/tls-and-domains); changing the bundle origin does not perform those external changes.

#### Rename the deploy operator’s address {#managed-operator-address-migration}

A managed deployment signs in as its `identity` operator on every run. To give that account a machine address, so that people sign in with accounts of their own, keep the account and change only its sign-in address. Its user ID, and everything bound to it — managed clients, operator-owned skills, API keys and retained journals — stays.

1. Set `identity.email` to the new address and `identity.migrateEmailFrom` to the exact previous address. The two must differ. Keep `identity.bootstrap: "fresh"` and the account’s password. Bootstrap must be complete, and a declared email attestation needs its completed journal.
2. Prepare, verify, preview and apply the bundle. The CLI reads the retained account’s current address inside the backend, signs in with it and proves the retained user ID. It journals the change, renames the account through the native adapter, ends every session the account holds and signs in again with the new address. The rename is guarded by the previous address, so a concurrent change is refused rather than overwritten. A declared email attestation then verifies the new address.
3. A retry after an interruption finds the address already moved and completes the journals without a second rename. Keeping `migrateEmailFrom` declared afterwards is harmless; remove it once the deployment receipt is ready.

Another account holding the new address, a retained account holding neither address, or a single sign-on link on the operator account stops the deployment before any change. Remove such a link first: it belongs to the person who signed in with it, not to a machine account.

#### Declare a break-glass administrator {#managed-break-glass}

`identity.breakGlass` keeps one administrator for when the deploy operator is unavailable, for example `{ "email": "break-glass@example.org", "passwordHash": { "env": "TALE_BREAK_GLASS_PASSWORD_HASH" } }`. The address is a literal or a required environment reference and must differ from the operator’s current and previous address. The password never reaches the deployment: create its hash where the password is kept, with `tale auth hash-password`, and supply only the hash.

Every deployment makes the backend match the declaration. An absent account is created with a verified address and exactly the declared credential, and a retained journal binds the address to its account ID as soon as the account exists. Later deployments set the bound account back to the declared credential and end every session it held whenever the credential changes, also when they finish an interrupted run. An account at the address that this deployment did not create, or a different account holding it later, stops the deployment. The account becomes an `admin` of the managed organization through the native member endpoints; an `owner` is never changed. The deployment never signs in as this account. Rotate its password by changing the declared hash, not in the application. The deployment records no password-change time, so an organization password rotation policy may ask this account for a new password, which the next deployment sets back.

#### Enforced two-factor sign-in

A managed deployment signs in as its operator with the password alone. When the organization enforces `two_factor_policy`, give the operator a passkey and never an authenticator app: a password sign-in of an account with an authenticator app is answered with a challenge, and an account with neither factor is held at enrolment once its grace period ends. The CLI stops at either answer and names the one it received. People sign in with their own accounts and may use either factor.

#### Export native-client credentials

To hand a managed client’s credentials to a separate application, set `NATIVE_CLIENT_KEY` to its declared key and `PRIVATE_EXPORT_DIRECTORY` to a new private output directory. Its parent must already belong to your account, have mode `0700` and have trusted ancestors. Export from the same ready deployment without interpreting backend paths or container names:

```bash
tale --json deploy export-client --bundle "$TALE_DEPLOY_BUNDLE" \
  --client "$NATIVE_CLIENT_KEY" --output "$PRIVATE_EXPORT_DIRECTORY" \
  --env-prefix TALE_OIDC --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

The output directory has mode `0700`. Its regular `0600` files are `client.json`, `receipt.json` and, when `--env-prefix` is selected, `consumer-env.json`. The latter is a literal four-string map: `TALE_OIDC_ISSUER`, `TALE_OIDC_CLIENT_ID`, `TALE_OIDC_CLIENT_SECRET` and `TALE_OIDC_ORG_SLUG`. The issuer is the Tale origin followed by `/api/auth`. Transfer these bytes through your private credential channel and let the application read JSON; do not source the file as shell or publish it as a CI artifact. Stdout contains only safe metadata, paths, sizes and hashes. An identical export is reused only after current ready-state and complete artifact checks; partial, stale or foreign output holds without overwrite.

### Configure the platform

Use `tale config` to manage existing platform settings through the native APIs. Save this declaration as `configuration.json` to set the accent color and a 45-minute idle timeout:

```json
{
  "schemaVersion": 1,
  "resources": [
    {
      "kind": "branding",
      "config": {
        "accentColor": "#336699"
      }
    },
    {
      "kind": "governance",
      "key": "session_idle_timeout",
      "config": {
        "enabled": true,
        "idleTimeoutMinutes": 45
      }
    }
  ]
}
```

Set `TALE_URL` to the instance’s HTTPS origin and `TALE_ORG_ID` to the native organization ID. Provide an authorized session cookie through `TALE_CONFIG_COOKIE`; keep it out of arguments and committed files. Validate locally, save and review the plan, then apply it and compare native state:

```bash
tale --json config validate --file configuration.json
tale --json config plan --file configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" --output configuration-plan.json
tale --json --yes config apply --file configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" \
  --plan configuration-plan.json --receipt configuration-receipt.json
tale --json config read --file configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID"
```

The output and receipt directories must already exist. A loopback HTTP connection also needs `--origin` with the instance’s public HTTPS origin. `read` reports `matches` for each declared resource. The plan identifies organization versus instance scope, current and desired hashes, and native side effects. Applying requires the exact declaration and target; a conflicting native edit refuses the write instead of overwriting it. Undeclared resources remain unchanged. There is no delete or arbitrary file-writing command.

These resource kinds use the platform’s shared schemas and native permissions:

| Kind                  | Configuration                                              | Scope        |
| --------------------- | ---------------------------------------------------------- | ------------ |
| `branding`            | Native branding fields                                     | Organization |
| `governance`          | A file-backed policy `key` and its native `config`         | Organization |
| `provider`            | A custom provider definition and optional `expectedModels` | Organization |
| `provider-credential` | Named environment credential metadata                      | Organization |
| `knowledge-embedding` | Provider, model, dimensions, endpoint and server limits    | Organization |
| `deployment`          | Instance deployment settings, including sandbox runtime    | Instance     |

Retention and DSAR policies require their dedicated native workflows. Pause uploads, synchronization and crawls before changing the embedding model. The CLI checks organization-wide document and website counts; it does not lock ingestion or migrate existing vectors. For an organization with documents or registered websites, a model change requires a separate native indexing migration. A change limited to `minSimilarity`, `maxConcurrentRequests` or `minTokensPerSecond` keeps existing vectors valid, so it skips this check. Instance settings also require the native deployment editor allowlist. Standalone application reports `restartRequired` for boot settings; saving those settings alone does not activate them. Review the plan’s effects before applying.

Managed deployments use the same engine through `configuration`. Merge this example into the deployment declaration when an external operator already serves the provider. Replace the synthetic endpoint and catalog with verified values, and inject `EXTERNAL_PROVIDER_SECRET` from your secret manager:

```json
{
  "environment": {
    "TALE_PROVIDER_KEY_EXTERNAL": {
      "env": "EXTERNAL_PROVIDER_SECRET"
    }
  },
  "configuration": {
    "schemaVersion": 1,
    "resources": [
      {
        "kind": "provider",
        "config": {
          "name": "external-chat",
          "displayName": "External chat",
          "apiFormat": "openai",
          "baseUrl": "https://models.example.invalid/v1",
          "catalog": {
            "source": "models-endpoint"
          },
          "embedding": "unknown",
          "auth": [
            {
              "method": "env"
            }
          ]
        },
        "expectedModels": [
          {
            "id": "Example-chat",
            "provider": "external-chat",
            "tags": ["chat"],
            "supportsTools": true,
            "supportsVision": false,
            "contextWindow": 131072
          }
        ]
      },
      {
        "kind": "provider-credential",
        "config": {
          "providerSlug": "external-chat",
          "authMethod": "env",
          "name": "Managed external provider",
          "envName": "TALE_PROVIDER_KEY_EXTERNAL",
          "modelAllowlist": ["Example-chat"]
        }
      }
    ]
  }
}
```

`envName` uses the native `TALE_PROVIDER_KEY_` prefix and 40-character limit. Each alias needs a required `environment` reference. Private endpoints additionally require an explicit `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS` reference whose value is `1`; native host restrictions still apply. `expectedModels` checks Tale’s freshly resolved catalog during readback. It does not prove inference capacity, latency or business output.

Use `governance` with `key: "vision_model"` and native `providerSlug`/`modelId` fields for vision selection. Embedding uses `knowledge-embedding` with `providerSlug`, `model`, `dimensions` and `baseUrl`, plus the optional settings the platform keeps next to the model in [`embedding.json`](/self-hosted/configuration/data-residency#the-organizations-embedding-model): `minSimilarity`, the assistant's cosine floor for this model, and the server limits `maxConcurrentRequests` and `minTokensPerSecond` ([Pace requests to a self-hosted embedding server](/self-hosted/configuration/data-residency#embedding-server-capacity)). Each follows the platform's own rule: a value sets it, an omitted key leaves whatever the file holds (a hand-set value survives a release that does not mention it), and `null` clears it — `"minSimilarity": null`, for example, is the only way to remove a floor through the CLI. To replace a default credential, also declare the existing environment credential with `isDefault: false`; the CLI applies that explicit change first. Credential values never enter the declaration or receipt.

Native provisioning runs after identity and before configuration releases. The `native.configuration` receipt binds the declaration and bundle hashes, organization, resource hashes and native revisions. Writes retain a pending receipt before the first change; if a later resource fails, earlier changes may remain. Read the native state and retained receipt, then retry the same reviewed plan. Native compare-and-set protects each resource against concurrent admin changes; there is no cross-resource transaction. Keep deployment state, snapshots and receipts for recovery.

Managed deployments also activate a declared `deployment` resource before reporting ready. The CLI records the pending activation, drains the verified sandbox spawner for up to five minutes, and restarts that container once sessions have finished. If sessions remain, the operation stays pending. The `configurationActivation` receipt records the mounted configuration and observed container boot; ready requires fresh health checks. Retrying an interrupted operation verifies an already accepted restart, and an unchanged ready replay does not restart the service again.

#### Replace a pending configuration plan

If an interrupted plan can still complete, retry that same plan. Use explicit replacement when its declared settings can no longer work, for example because an embedding endpoint is no longer available. Keep the existing receipt: it records writes that may already have reached the platform.

1. Read the pending receipt and compare the declared resources with current native state. Prepare `replacement-configuration.json` with corrected settings, the same target and exactly the same resource identities. You cannot use replacement to add or drop resources.
2. Calculate the hash of the retained receipt’s `plan`, not the whole receipt or the replacement plan. The following command requires Bun and hashes canonical JSON: object keys sorted recursively, array order preserved, and no whitespace.

```bash
PENDING_PLAN_SHA=$(bun -e '
  const receipt = await Bun.file(process.argv[1]).json();
  if (receipt.phase !== "pending") throw new Error("Receipt is not pending");
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value !== null && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(key =>
        JSON.stringify(key) + ":" + canonical(value[key])
      ).join(",") + "}";
    }
    return JSON.stringify(value);
  }
  console.log(new Bun.CryptoHasher("sha256")
    .update(canonical(receipt.plan)).digest("hex"));
' configuration-receipt.json)
```

3. Create a fresh plan from the replacement declaration and review it before applying:

```bash
tale --json config plan --file replacement-configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" --output replacement-plan.json
```

After reviewing the plan, apply it with the original receipt path and the retained plan’s hash:

```bash
tale --json --yes config apply --file replacement-configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID" \
  --plan replacement-plan.json --receipt configuration-receipt.json \
  --supersedes-pending-plan "$PENDING_PLAN_SHA"
tale --json config read --file replacement-configuration.json \
  --url "$TALE_URL" --org "$TALE_ORG_ID"
```

Each resource must still match the pending plan’s original state, intended write, or verified result. An unrelated native edit blocks replacement before any write. Resolve that difference with the administrator who made it; do not remove the receipt to bypass the check.

The receipt retains the previous plan and its verified resources under `superseded`, including across interruption and replay. Check that the receipt reaches `phase: "ready"` and that `config read` reports matching resources. Omit the one-shot selector from later operations.

For a managed deployment, set `supersedesPendingConfigurationPlan` to the same retained plan hash in the deployment specification, alongside the corrected `configuration`, then prepare and review a new bundle. If that bundle also replaces a pending rollout, select its hash separately with `supersedesPendingBundle`. That bundle selector alone does not authorize replacing a native configuration plan. Remove both recovery selectors from later specifications after the operation is ready.

The public `native.configuration` proof records each resource’s intended hash as `configurationSha256` and its native readback hash as `observedConfigurationSha256`. These can differ when a setting preserves an existing value, such as an omitted embedding similarity floor or server limit. The private receipt retains the exact observed state for recovery.

### Operate

`tale status` — show the current deployment status. No arguments.

`tale logs <service>` — stream a service's logs (`service` is one of the running services; on a dev-only stack with no deployment, it falls back to the dev container).

- `-f, --follow` — follow log output as it is written.
- `-n, --tail <lines>` — show only the last N lines.
- `--since <duration>` — show logs since a relative time (e.g. `1h`, `30m`).
- `-c, --color <color>` — target a specific deployment colour (`blue` or `green`).
- `--raw` — stream raw, unfiltered log output (no classification).

`tale backup` — snapshot the supported, existing project volumes. No arguments. External databases and buckets need separate backups; see [Backup coverage](/self-hosted/operate/backups-and-restore).

`tale restore [snapshot-id]` — restore a snapshot; omit the id to list available snapshots.

- `--stop` — stop running project containers before restoring.
- `-y, --yes` — skip the confirmation prompt.

`tale rollback` — roll back to the previous patch version (patch-level only). Prompts for confirmation before it touches anything.

- `-y, --yes` — skip the confirmation prompt (required when running non-interactively).

### Maintain

`tale update`—move a workspace instance to a new version: update the CLI binary, then sync project files; run `tale deploy` afterward. Workspace commands align to that version. Managed bundles and configuration releases retain their separately pinned CLI revision.

- `-v, --version <version>` — update to this exact version (e.g. `0.9.0`) instead of the latest; allows downgrades.
- `-f, --force` — force re-sync and overwrite locally modified project files.
- `--dry-run` — show what would change without modifying anything.

`tale migrate` — re-provision the built-in defaults for every organization against the running deployment — the same idempotent step every deploy runs, on demand. Schema migrations are not a command: the backend applies them at boot, so a deployed container is always at its own schema.

- `--dry-run` — show what would run without executing it.

`tale cleanup` — remove inactive (non-current colour) containers. No arguments.

`tale reset` — remove all blue-green containers.

- `-f, --force` — skip the confirmation prompt.
- `-a, --all` — also remove the stateful infrastructure containers.
- `--dry-run` — preview the reset without making changes.

`tale uninstall` — remove the `tale` CLI binary from this system. It prompts before deleting anything and _offers_ to also remove the per-user config (`~/.tale-daemon`) and tear down a project's Docker resources and files. Without `--purge`, a project and its containers are left intact — run `tale reset --all` inside one to remove those.

- `-f, --force` — skip the confirmation prompt (removes the binary only; the optional cleanups still need `--purge`).
- `--purge` — also remove `~/.tale-daemon` and, for a project found from the current directory, tear down its Docker resources and delete its files. Irreversible.
- `--dry-run` — show what would be removed without removing anything.

`tale config show`—print the resolved local project directory and CLI version. Outside a project, it reports that no project was found and exits successfully.

### Configuration releases

These commands use the selected CLI revision without instance alignment or Docker operations. [Release client configurations](/self-hosted/configuration/config-releases) covers descriptors, source commits, credentials and recovery. The default release identity is the full source SHA: manifest schema 4/compiler 3, with `releaseRef === sourceCommit`. Native integer automation versions remain separate.

`build`, `verify` and `stage` require `--repo <directory>`, `--descriptor <path>` and `--automation <name>`. The descriptor is repository-relative. A verification manifest may be absolute or repository-relative.

| Command              | Required options                             | Optional options                                                                                                          |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tale config build`  | `--source-commit <sha>`                      | `--skill-owner <user-id>` (required for owned skills), `--output <directory>`, compatibility `--config-version <version>` |
| `tale config verify` | `--manifest <path>`                          | `--rebuild` for exact offline reconstruction                                                                              |
| `tale config stage`  | `--config-ref <sha>`, `--output <directory>` | `--skill-owner <user-id>`, `--client <name>`, `--deployment-ref <sha>`                                                    |

Source staging requires checkout `HEAD` at that full commit and output outside the checkout. It rebuilds committed content without a generated catalogue commit. Explicit `stage --config-version` instead selects the compatibility catalogue path and requires `--catalogue-commit`, `--catalogue-repository`, `--client` and `--ops-commit`. Do not mix `--config-ref` and `--config-version`.

Native commands require `--stage <directory>`, `--url <origin>`, `--org <id>` and `--project <id>`. HTTPS is required except for loopback HTTP; use `--origin <origin>` for the canonical browser origin behind a proxy. Both read `TALE_CONFIG_COOKIE` only from the environment.

| Command                     | Required options          | Optional options                                       |
| --------------------------- | ------------------------- | ------------------------------------------------------ |
| `tale config deploy`        | `--receipt <path>`        | Global `--yes` for an authorized unattended deployment |
| `tale config verify-native` | No extra required options | `--native-version <number>`, `--allow-retained`        |

Both native commands accept exact expectations through `--config-ref`, `--source-repository`, `--artifact-sha256`, `--deployment-ref`, `--client` and `--automation`. Historical catalogue expectation flags remain available for compatibility. `verify-native` is read-only; `--allow-retained` verifies an explicitly selected retained version without claiming it is deployed. Without `--native-version`, verification selects the latest saved version. The native API exposes the task contract only for the deployed version, so retained verification cannot attest that field.

Configuration commands have no `--dry-run`: use `stage`, `verify --rebuild` and `verify-native`. Success JSON is `{ok:true,command:"config <verb>",data}`. Build and verify data include `automationName`, `releaseRef`, `sourceCommit`, `artifactSha256`, `artifactPath` and `verified`; compatibility output uses `configVersion` instead of `releaseRef`. SHA stage and native receipts use schema 2. A deploy result includes `automationVersion` and `unchanged`; the explicit `verified` field belongs to verification output.

### Advanced

`tale auth hash-password` — print the Better Auth hash of a password, for a [break-glass administrator](#managed-break-glass).

It reads the password from stdin, or from a hidden prompt with confirmation in an interactive terminal. It refuses a password that fails the platform’s default password policy and prints nothing but the hash.

`tale auth reset-owner` — reset the owner account credentials.

For a manual recovery, run it without flags in an interactive terminal to enter the new password through a masked prompt. This avoids putting the password in shell history or command arguments. The reset invalidates existing sessions.

- `-e, --email <email>` — set a new owner email address.
- `-p, --password <password>` — set a new owner password.

## Troubleshooting

- **`tale deploy` targets the wrong machine.** The CLI uses your shell's Docker context / `DOCKER_HOST`. Switch with `docker context use …` (or set `DOCKER_HOST`) so it points at the intended host, then re-run.
- **`tale deploy` uses the wrong host alias.** The host the proxy answers on comes from `HOST` in the project's `.env`, not a separate CLI store. Edit `.env` or pass `--host` to override it for one run.
- **Installer fails on macOS because the binary cannot execute.** When the freshly installed binary refuses to run (e.g. Gatekeeper kills it), the installer fails with recovery hints instead of reporting success — follow them, then re-run the installer.
- **`tale` not found after install on Linux.** The installer drops the binary in `/usr/local/bin`; verify the directory is on the user's `PATH` (`echo $PATH`).

For ongoing operations, use [Upgrades](/self-hosted/operate/upgrades), [Backups and restore](/self-hosted/operate/backups-and-restore), or [Container architecture](/self-hosted/operate/container-architecture).
