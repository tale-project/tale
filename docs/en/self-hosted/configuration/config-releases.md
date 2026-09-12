---
title: Release client configurations
description: Build, verify and deploy a versioned automation pack from a client repository with the Tale CLI, then verify its native workflow and skill bytes.
---

The Tale CLI releases automation packs from a client's own repository to an existing organization and project. The full source commit identifies each new release, so you can reproduce its workflow and owned skill files without committing generated archives. Client repositories own their content and correctness tests; deployment automation selects the destination, source commits and CLI revision, then calls Tale's deployment commands.

This guide covers configuration alone. To deploy the instance and its configuration together, use the [managed deployment commands](/self-hosted/install/cli-install#managed-deployments); the CLI also owns runtime preparation, rollout and native provisioning.

## Before you begin

Install the [Tale CLI](/self-hosted/install/cli-install) and pin a revision that supports the target server's pack format and APIs. Configuration commands take explicit source and target options; they need no local `tale.json`, Docker context or adjacent Tale source checkout. The bundled parser and validator check supported fields, without adding newer server capabilities to an older instance.

You need a committed client descriptor and pack, an existing organization and project, and an authorized native operator session. If the pack owns skills, use that user's native ID as the build owner. The ID is distinct from a project, organization or external identity ID.

For a new instance without native IDs, use managed deployment with an explicit fresh identity, symbolic project and `skillOwner: "operator"`. It carries verified source and compiles only after proving the native operator; these standalone release commands still require resolved IDs. Keep business configuration in its client-owned source tree. External model settings belong to the deployment declaration.

The examples use the synthetic `example-team` client and `document-review` automation. Inject the full operator session cookie through `TALE_CONFIG_COOKIE` from your secret manager. Keep it out of arguments, source, archives, receipts and logs.

## Step 1—Keep the content in the client repository

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

## Step 2—Build and verify the source commit

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

## Step 3—Stage the exact source commit

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

## Step 4—Deploy and read the result back

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

Retain the stage and receipt. A retry can reuse exact skills and continue from a trusted saved receipt, or fully verify an already deployed matching version. If an upload response is lost and only an unpublished matching version is visible, the CLI holds because the native API cannot read its complete task contract before deployment. Do not manufacture a receipt or import a duplicate to bypass that hold.

Coordinate deployments that share a destination. Local locking does not provide cross-host compare-and-swap or prevent native administrator edits. Investigate drift against the retained release; an overwrite flag is not a recovery path.

Existing semantic releases remain a compatibility path: `build --config-version` selects schema 3/compiler 2; `stage --config-version` uses the committed catalogue and its explicit catalogue/ops pins. Keep original manifests and archives unchanged. A descriptor can register checksummed historical source snapshots for offline reconstruction; only that format's supported fields can be verified. Legacy shared skills may be reused only when explicitly allowed and already byte-identical. Restore different historical content through a new release.

Historical reconstruction needs additional tools. Schema 1 uses Git's `archive --mtime` capability; check your selected Git supports it. Schema 2/compiler 1 uses Python 3's standard library. Schema 3/compiler 2, schema 4/compiler 3 and native deployment do not need Python.

## Keep the release verifiable

You now have a selected source commit, reproducible artifacts and a native receipt that can be checked against actual content. Retain the source, tests, reviewed artifacts and deployment pins together. The [CLI reference](/self-hosted/install/cli-install) also covers complete managed instance deployments; [Upgrades](/self-hosted/operate/upgrades) and [Backups and restore](/self-hosted/operate/backups-and-restore) cover the surrounding lifecycle.
