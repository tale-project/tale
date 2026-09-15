---
title: Release client configurations
description: Build, verify and deploy a versioned automation pack from a client repository with the Tale CLI, then verify its native workflow and skill bytes.
---

A configuration release installs a reviewed workflow and its owned skills into an existing organization and project. Its identity is the full source commit. Use this procedure when the application runtime stays in place; use [managed deployments](/self-hosted/install/cli-install#managed-deployments) for a new instance or runtime change.

## Know what each command produces

| Command | Result to check before continuing |
| --- | --- |
| `config build` | A manifest and compiled archives from a committed source revision. |
| `config verify --rebuild` | Independent reconstruction agrees with the reviewed artifacts. |
| `config stage` | A transferable directory containing only the deployment files and their hashed inventory. |
| `config deploy` | The workflow and owned skills are installed, read back, and recorded in a persistent receipt. |
| `config verify-native` | A read-only comparison with the currently installed content. |

A **native** ID or session in these commands belongs to the target Tale instance. A **receipt** records a deployment result; it does not replace checking the current server. Format and byte verification do not prove the automation's business result, so keep domain tests in the client repository.

## Before you begin

Install the [Tale CLI](/self-hosted/install/cli-install) and pin a revision that supports the target server's pack format and APIs. Configuration commands take explicit source and target options; they need no local `tale.json`, Docker context or adjacent Tale source checkout. The bundled parser and validator check supported fields, without adding newer server capabilities to an older instance.

You need a committed client descriptor and pack, an existing organization and project, and an authorized native operator session. If the pack owns skills, use that user's native ID as the build owner. The ID is distinct from a project, organization or external identity ID.

For a new instance without native IDs, use managed deployment with an explicit fresh identity, symbolic project and `skillOwner: "operator"`. It carries verified source and compiles only after proving the native operator; these standalone release commands still require resolved IDs. Keep business configuration in its client-owned source tree. External model settings belong to the deployment declaration.

The examples use the synthetic `example-team` client and `document-review` automation. Inject the full operator session cookie through `TALE_CONFIG_COOKIE` from your secret manager. Keep it out of arguments, source, archives, receipts and logs.

## Commit the descriptor and pack

Store the descriptor at `tale/client.json`, packs beneath `tale/packs/`, and domain tests beside them. Keep any retained historical release catalogue there too. Descriptor paths resolve relative to its own directory.

Ignore `.tale/` if it is not already in the client's `.gitignore`. Default builds keep local coordination state there; explicit output operations coordinate beside their output. Maintained configuration uses `tale/` without the dot.

```json
{
  "schemaVersion": 1,
  "clientId": "example-team",
  "sourceRepository": "https://github.com/example-team/client-app",
  "automations": [
    {
      "name": "document-review",
      "displayName": "Document review",
      "packPath": "packs/document-review",
      "releasesPath": "releases/document-review",
      "logicalSkillSlugs": ["record-check"],
      "requiredExternalSkills": []
    }
  ]
}
```

`logicalSkillSlugs` lists the skill directories carried by this pack. `requiredExternalSkills` lists dependencies already installed in Tale: the CLI checks their presence, but this release does not pin their bytes. Keep credentials, target hostnames and project IDs in deployment configuration. Commit the descriptor and pack; the compiler reads Git objects rather than uncommitted edits.

## Build and verify the source commit

Set `CONFIG_REPO` to the checkout, `CONFIG_SOURCE_COMMIT` to its full 40-character source commit, and `TALE_NATIVE_USER_ID` to the native operator ID. Choose a new absolute `CONFIG_BUILD` output directory outside the checkout. These commands build the release and independently reconstruct its bytes.

```bash
tale --json config build \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --source-commit "$CONFIG_SOURCE_COMMIT" \
  --skill-owner "$TALE_NATIVE_USER_ID" \
  --output "$CONFIG_BUILD"

tale --json config verify \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --manifest "$CONFIG_BUILD/$CONFIG_SOURCE_COMMIT.json" \
  --rebuild
```

The default manifest uses schema 4/compiler 3 and records `releaseRef` equal to `sourceCommit`, plus the pack tree, descriptor hash and complete compiled inventory. The output contains a canonical ZIP, one ZIP per owned skill and a workflow-only installation ZIP. Owned skill slugs carry the full source SHA, with compiler metadata preserving their logical identity. The complete skill bytes include the declared owner; changing that owner requires a new source commit and release.

Require identical bytes on rebuild and run the client's correctness tests against the extracted canonical ZIP. Preserve the reviewed artifacts and record `artifactSha256` as `CONFIG_ARTIFACT_SHA256`. Native format validation proves that the pack can be interpreted, not that its business results are correct. New source-based deployments do not need an extra commit containing generated release files.

## Prepare the transfer directory

Use a checkout whose `HEAD` matches `CONFIG_SOURCE_COMMIT`. Set `CONFIG_STAGE` to a new absolute output directory outside that checkout. The optional `DEPLOYMENT_COMMIT` records the full commit of your deployment declaration; omit `--deployment-ref` if you do not track one.

```bash
tale --json config stage \
  --repo "$CONFIG_REPO" \
  --descriptor tale/client.json \
  --automation document-review \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --skill-owner "$TALE_NATIVE_USER_ID" \
  --client example-team \
  --deployment-ref "$DEPLOYMENT_COMMIT" \
  --output "$CONFIG_STAGE"
```

The stage builds the committed descriptor and pack, independently verifies the archives and prepares only allowlisted deployment files with a hashed inventory. Dirty source edits do not enter it. Check that its artifact hash matches the reviewed build. Preserve the stage as one unit during transfer; the native destination needs neither the client checkout nor its Git credential.

Pin the client repository URL and full source SHA, Tale CLI revision and optional deployment revision. Source provenance also depends on your trusted checkout: a URL in a descriptor does not establish which remote supplied a local Git object.

## Deploy and read the result back

Set `TALE_CONFIG_URL`, `TALE_CONFIG_ORIGIN`, `TALE_ORG_ID` and `TALE_PROJECT_ID` to the approved native target. Keep `CONFIG_RECEIPT` on persistent storage. After reviewing the stage, supply `--yes` for an authorized unattended deployment, then run a separate read-only verification. Use the same optional deployment reference as the stage.

```bash
tale --json --yes config deploy \
  --stage "$CONFIG_STAGE" \
  --url "$TALE_CONFIG_URL" \
  --origin "$TALE_CONFIG_ORIGIN" \
  --org "$TALE_ORG_ID" \
  --project "$TALE_PROJECT_ID" \
  --receipt "$CONFIG_RECEIPT" \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --source-repository https://github.com/example-team/client-app \
  --artifact-sha256 "$CONFIG_ARTIFACT_SHA256" \
  --deployment-ref "$DEPLOYMENT_COMMIT"

tale --json config verify-native \
  --stage "$CONFIG_STAGE" \
  --url "$TALE_CONFIG_URL" \
  --origin "$TALE_CONFIG_ORIGIN" \
  --org "$TALE_ORG_ID" \
  --project "$TALE_PROJECT_ID" \
  --config-ref "$CONFIG_SOURCE_COMMIT" \
  --source-repository https://github.com/example-team/client-app \
  --artifact-sha256 "$CONFIG_ARTIFACT_SHA256" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

The target URL is where the API is reachable; the origin is the canonical browser origin, including when the API URL is loopback behind a proxy. The authenticated native user must match the declared skill owner.

Deployment creates missing owned skills through native create-only upload and verifies every installed byte. Existing exact bytes can be reused; differing bytes at the release slug cause a refusal. Workflow-only import cannot write skills. Before reporting success, the CLI checks the deployed workflow, settings, presentation, task contract and project binding.

Run `verify-native` after deployment and operational tests. It imports nothing and creates no version or receipt. A repeat deployment also reads current native content before reporting an unchanged release; a stored receipt alone does not prove current bytes.

## Recover a stopped deployment

Keep the exact stage and receipt while investigating. Choose the next action from the state the CLI reports:

| State | Safe next step |
| --- | --- |
| A trusted receipt records partial progress | Retry with the same stage, target, and receipt. Exact skills can be reused. |
| A matching version is already deployed | Read it back with `verify-native`; a repeated deploy also verifies before reporting no change. |
| An upload response was lost and only an unpublished version is visible | Stop and investigate. The native API cannot read its complete task contract before deployment, so the CLI cannot prove that version safe to reuse. |
| A release skill slug exists with different bytes | Preserve the evidence and identify the conflicting release or edit. Do not overwrite it to make verification pass. |
| A receipt is unreadable or names another target | Restore the correct record or resolve the mismatch before retrying. Never manufacture a successful receipt. |

Coordinate deployments that share a destination. Local locking does not prevent another host or an administrator from changing native content. After recovery, rerun the client's operational checks and the independent native verification.

## Reconstruct a historical release

Existing semantic releases remain a compatibility path: `build --config-version` selects schema 3/compiler 2; `stage --config-version` uses the committed catalogue and its explicit catalogue/ops pins. Keep original manifests and archives unchanged. A descriptor can register checksummed historical source snapshots for offline reconstruction; only that format's supported fields can be verified. Legacy shared skills may be reused only when explicitly allowed and already byte-identical. Restore different historical content through a new release.

Historical reconstruction needs additional tools. Schema 1 uses Git's `archive --mtime` capability; check your selected Git supports it. Schema 2/compiler 1 uses Python 3's standard library. Schema 3/compiler 2, schema 4/compiler 3 and native deployment do not need Python.

Retain the source, client tests, reviewed archives, CLI revision, deployment pins, and receipt together. Keep session cookies and credentials in your secret manager, outside those artifacts. [Upgrades](/self-hosted/operate/upgrades) and [Backups and restore](/self-hosted/operate/backups-and-restore) cover recovery of the surrounding runtime and data.
